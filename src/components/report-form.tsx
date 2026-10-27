"use client";

import { AccessCodeField, accessHeaders, useAccessCode } from "./access-code";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Engine } from "@/lib/types";
import { DEMO_SCENARIOS, type DemoScenario } from "./demo-scenarios";
import { effectiveEngine, type EngineAvailability } from "./engine-choice";
import { EngineSwitch } from "./engine-switch";
import { prepareImage } from "./image-prep";
import { VoiceRecorder, type VoiceResult } from "./voice-recorder";
import {
  ACCEPTED_PHOTO_TYPES,
  MAX_PHOTOS,
  validatePhotos,
  validateReport,
  type FieldErrors,
} from "./report-validation";

interface PhotoItem {
  key: string;
  file: File;
  url: string;
}

type LanguageChoice = "auto" | "en" | "fr";

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted aria-[invalid=true]:border-danger";

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The "inbox" of the demo: a customer damage report as it would arrive by e-mail or chat.
 * Submitting runs the agent and opens the resulting case. Demo buttons pre-fill the form
 * with one of the six filmable scenarios (fictitious customer, illustration photos).
 */
export function ReportForm({ availability }: { availability: EngineAvailability }) {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [language, setLanguage] = useState<LanguageChoice>("auto");
  const [engine, setEngine] = useState<Engine>("muse-spark-1.3");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedCaseId, setSavedCaseId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadedDemo, setLoadedDemo] = useState<string | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);
  // Set once a voice message was transcribed into the message box; sent with the report so
  // the case can say how the text was written.
  const [voice, setVoice] = useState<VoiceResult | null>(null);
  const [accessCode, setAccessCode] = useAccessCode();
  const hasAccess = accessCode.trim() !== "";
  const fileInput = useRef<HTMLInputElement>(null);
  const orderRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  function onVoiceTranscript(result: VoiceResult): void {
    setVoice(result);
    // Never overwrite what the customer already typed: the transcript goes after it.
    setMessage((current) => (current.trim() ? `${current.trimEnd()}\n\n${result.transcript}` : result.transcript));
    setErrors((e) => ({ ...e, message: undefined }));
    messageRef.current?.focus();
  }

  function addFiles(files: File[]): void {
    const room = MAX_PHOTOS - photos.length;
    const accepted = files.slice(0, Math.max(0, room));
    const next = [...photos, ...accepted.map((file) => ({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))];
    // Check what was picked, not only what fits, so "4 photos" still explains itself.
    const problem = files.length > room ? `You can attach up to ${MAX_PHOTOS} photos.` : validatePhotos(next.map((p) => p.file));
    setPhotos(next);
    setErrors((e) => ({ ...e, photos: problem ?? undefined }));
  }

  function removePhoto(key: string): void {
    const target = photos.find((p) => p.key === key);
    if (target) URL.revokeObjectURL(target.url);
    setPhotos((list) => list.filter((p) => p.key !== key));
    setErrors((e) => ({ ...e, photos: undefined }));
  }

  async function loadScenario(s: DemoScenario): Promise<void> {
    setLoadingDemo(true);
    setServerError(null);
    setSavedCaseId(null);
    try {
      const files = await Promise.all(
        s.photos.map(async ({ src, fallback }) => {
          // The demo photo if the server has it, the flat illustration otherwise.
          let url = src;
          let res = await fetch(url);
          if (!res.ok) {
            url = fallback;
            res = await fetch(url);
          }
          if (!res.ok) throw new Error(`demo photo ${url} not found`);
          const blob = await res.blob();
          const type = blob.type || "image/png";
          const ext = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
          const stem = (new URL(url, "http://local").searchParams.get("name") ?? url.split("/").pop() ?? "photo").replace(/\.[a-z]+$/i, "");
          return new File([blob], `${stem}.${ext}`, { type });
        }),
      );
      for (const p of photos) URL.revokeObjectURL(p.url);
      setPhotos(files.map((file) => ({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file) })));
      setOrderNumber(s.orderNumber);
      setEmail(s.email);
      setMessage(s.message);
      setVoice(null);
      setLanguage(s.language);
      setErrors({});
      setLoadedDemo(s.title);
    } catch {
      setErrors({ photos: "Could not load the demo photos. Attach your own photo instead." });
    } finally {
      setLoadingDemo(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setServerError(null);
    setSavedCaseId(null);

    const found = validateReport({ orderNumber, email, message }, photos.map((p) => p.file));
    setErrors(found);
    const firstInvalid = (["orderNumber", "email", "message"] as const).find((f) => found[f]);
    if (firstInvalid) {
      const target = { orderNumber: orderRef, email: emailRef, message: messageRef }[firstInvalid];
      target.current?.focus();
      return;
    }
    if (found.photos) {
      fileInput.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData();
      body.set("orderNumber", orderNumber.trim());
      body.set("email", email.trim());
      body.set("message", message.trim());
      body.set("engine", engine);
      if (language !== "auto") body.set("language", language);
      if (voice && message.trim()) {
        body.set(
          "voiceNote",
          JSON.stringify({
            durationMs: voice.durationMs,
            demo: voice.demo,
            // Edited when the transcript is no longer in the message as it was dictated.
            edited: !message.includes(voice.transcript),
          }),
        );
      }
      for (const file of await Promise.all(photos.map((p) => prepareImage(p.file)))) body.append("photos", file);

      const res = await fetch("/api/reports", { method: "POST", body, headers: accessHeaders(accessCode) });
      const data = (await res.json().catch(() => null)) as {
        caseId?: string;
        message?: string;
        fields?: FieldErrors;
      } | null;
      if (res.ok && data?.caseId) {
        router.push(`/cases/${encodeURIComponent(data.caseId)}`);
        return;
      }
      if (data?.fields) setErrors(data.fields);
      setServerError(data?.message ?? "The report could not be processed.");
      if (data?.caseId) setSavedCaseId(data.caseId);
    } catch {
      setServerError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const runsAs = effectiveEngine(engine, availability, hasAccess);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6" aria-describedby="form-intro">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Report a damaged parcel</h1>
          <p id="form-intro" className="mt-2 text-sm text-muted">
            This simulates the e-mail or chat message a customer sends. The agent looks up the order, reads
            the photos, decides and prepares the carrier claim. Nothing is sent to anyone.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="orderNumber" label="Order number" error={errors.orderNumber}>
            <input
              id="orderNumber"
              ref={orderRef}
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="#1001"
              autoComplete="off"
              aria-invalid={Boolean(errors.orderNumber)}
              aria-describedby={errors.orderNumber ? "orderNumber-error" : undefined}
              className={INPUT_CLASS}
            />
          </Field>
          <Field id="email" label="E-mail used for the order" error={errors.email}>
            <input
              id="email"
              type="email"
              ref={emailRef}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              autoComplete="off"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <Field
          id="message"
          label="Message from the customer"
          error={errors.message}
          hint="Type it or record it. Any language. The reply is written in the customer's language."
        >
          <textarea
            id="message"
            ref={messageRef}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              // Emptied and retyped: it is a typed message now, not a dictated one.
              if (e.target.value.trim() === "") setVoice(null);
            }}
            rows={5}
            placeholder="My vase arrived broken…"
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? "message-error" : "message-hint"}
            className={INPUT_CLASS}
          />
          <VoiceRecorder
            language={language}
            accessCode={accessCode}
            disabled={submitting}
            onTranscript={onVoiceTranscript}
          />
        </Field>

        <Field id="language" label="Customer language">
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as LanguageChoice)}
            className={`${INPUT_CLASS} sm:w-60`}
          >
            <option value="auto">Detect from the message</option>
            <option value="en">English</option>
            <option value="fr">French</option>
          </select>
        </Field>

        <div className="flex flex-col gap-2">
          <label htmlFor="photos" className="text-sm font-medium">
            Photos of the damage (1 to {MAX_PHOTOS}, JPEG, PNG or WebP, 8 MB each)
          </label>
          <input
            id="photos"
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPTED_PHOTO_TYPES.join(",")}
            disabled={photos.length >= MAX_PHOTOS}
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
            aria-invalid={Boolean(errors.photos)}
            aria-describedby={errors.photos ? "photos-error" : undefined}
            className="text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-background"
          />
          {errors.photos && (
            <p id="photos-error" role="alert" className="text-sm text-danger">
              {errors.photos}
            </p>
          )}
          {photos.length > 0 && (
            <ul className="mt-1 grid grid-cols-3 gap-3" aria-label="Attached photos">
              {photos.map((p, i) => (
                <li key={p.key} className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, nothing to optimise */}
                  <img src={p.url} alt={`Attached photo ${i + 1}: ${p.file.name}`} className="aspect-[4/3] w-full rounded object-cover" />
                  <span className="truncate text-xs text-muted" title={p.file.name}>
                    {p.file.name} · {formatSize(p.file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePhoto(p.key)}
                    className="self-start text-xs font-medium text-danger underline underline-offset-2"
                  >
                    Remove <span className="sr-only">photo {i + 1}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <EngineSwitch value={engine} onChange={setEngine} availability={availability} hasAccess={hasAccess} />
        {availability.accessCodeRequired && (
          <AccessCodeField
            id="access-code"
            value={accessCode}
            onChange={setAccessCode}
            hint="This public demo runs in demo mode for everyone. Real engines (Muse, open weights) need the access code. Never type real customer data here."
          />
        )}

        {serverError && (
          <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
            {serverError}
            {savedCaseId && (
              <>
                {" "}
                <Link href={`/cases/${encodeURIComponent(savedCaseId)}`} className="font-semibold underline">
                  Open the saved case
                </Link>
                .
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
          >
            {submitting && (
              <span
                aria-hidden="true"
                className="motion-safe-spin h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            )}
            {submitting ? "Investigating…" : "Send report"}
          </button>
          <p role="status" className="text-sm text-muted">
            {submitting
              ? `The agent is looking up the order and reading the photos (${runsAs === "demo-mock" ? "demo mode" : "this can take a little while"}).`
              : loadedDemo
                ? `Demo case loaded: ${loadedDemo}. Review it, then send.`
                : ""}
          </p>
        </div>
      </form>

      <aside aria-labelledby="demo-title" className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
        <div>
          <h2 id="demo-title" className="text-base font-semibold">
            Demo cases
          </h2>
          <p className="mt-1 text-sm text-muted">
            One click fills the form with a fictitious customer and illustration photos. Then press Send report.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {DEMO_SCENARIOS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => void loadScenario(s)}
                disabled={loadingDemo || submitting}
                className="w-full rounded-lg border border-border bg-surface p-3 text-left hover:border-accent disabled:opacity-60"
              >
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="block text-xs text-muted">{s.shows}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
