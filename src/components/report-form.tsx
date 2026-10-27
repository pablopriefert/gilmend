"use client";

import { AccessCodeField, accessHeaders, useAccessCode } from "./access-code";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ChevronDown, CircleAlert, KeyRound, LoaderCircle, Lock } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { Engine } from "@/lib/types";
import { cn } from "@/lib/utils";
import FileDropzone, { type FileDropzoneItem } from "./arc/file-dropzone/file-dropzone";
import SegmentedControl from "./arc/segmented-control/segmented-control";
import { DEMO_SCENARIOS, type DemoScenario } from "./demo-scenarios";
import { effectiveEngine, type EngineAvailability } from "./engine-choice";
import { EngineSwitch } from "./engine-switch";
import { prepareImage } from "./image-prep";
import { NDJSON_CONTENT_TYPE, readStreamEvents } from "@/lib/agent/events";
import { BUTTON_QUIET } from "./case/ui";
import { AgentWorking } from "./report/agent-working";
import { LiveRun } from "./report/live-run";
import { initialLiveRun, loseLiveRun, reduceLiveRun, type LiveRunState } from "./report/live-run-state";
import { Field, FieldError, INPUT_CLASS, Section } from "./report/form-primitives";
import { ScenarioCard } from "./report/scenario-card";
import { VoiceRecorder, type VoiceResult } from "./voice-recorder";
import { BorderBeam } from "./ui/border-beam";
import { ShimmerButton } from "./ui/shimmer-button";
import {
  ACCEPTED_PHOTO_TYPES,
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  validatePhotos,
  validateReport,
  type FieldErrors,
} from "./report-validation";

type LanguageChoice = "auto" | "en" | "fr";

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
];

const PRIVATE_DICTATION_ERROR =
  "This message was dictated with the Meta API, so it cannot run privately. Clear it and type it, or pick another engine.";

const ACCESS_CODE_NEEDED =
  "Enter the access code from the submission to send a report. This public demo takes no new report without it.";

/**
 * The "inbox" of the demo: a customer damage report as it would arrive by e-mail or chat.
 * Submitting runs the agent and opens the resulting case. Demo cards pre-fill the form
 * with one of the six filmable scenarios (fictitious customer, AI-generated demo images).
 *
 * Redesigned 27 Oct 2026 (Gilmend): presentation only. Every rule below (validation, limits,
 * the access code, the private-run dictation ban, the voice receipts, what is posted) is
 * unchanged from the first version.
 */
// A server that streams answers within a few seconds (it has only to store the report). Past this
// with nothing heard, the answer is not being streamed (a proxy that buffers, an older server):
// the page then falls back to the illustration, labelled as one.
const STREAM_SILENCE_MS = 10_000;

/** Wait before showing the next event of a DEMO MODE run: its steps take milliseconds and would flash by. */
const DEMO_PACE_MS = 450;

/** The events a DEMO MODE run pauses on (a step starting or ending): enough for each row to be seen. */
const PACED_EVENTS: ReadonlySet<string> = new Set(["accepted", "tool_start", "tool_end", "guardrail", "notice"]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function ReportForm({
  availability,
  demoPaceMs = DEMO_PACE_MS,
  silenceMs = STREAM_SILENCE_MS,
}: {
  availability: EngineAvailability;
  /** Pause between the events of a DEMO MODE run (the scripted steps are instant). Tests pass 0. */
  demoPaceMs?: number;
  /** How long the server may stay silent before the page falls back to the illustration. */
  silenceMs?: number;
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [language, setLanguage] = useState<LanguageChoice>("auto");
  const [engine, setEngine] = useState<Engine>("muse-spark-1.3");
  // The photos to send. The Arc dropzone owns the list on screen and reports it here.
  const [files, setFiles] = useState<File[]>([]);
  // A demo case replaces the dropzone's rows: it is remounted (new key) with them as its start.
  const [dropzoneKey, setDropzoneKey] = useState(0);
  const [seedItems, setSeedItems] = useState<FileDropzoneItem[] | undefined>(undefined);
  const seedUrls = useRef<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedCaseId, setSavedCaseId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The live timeline of the run being streamed (null until a report is sent), and whether the
  // server has been silent for so long that the answer is evidently not streamed.
  const [live, setLive] = useState<LiveRunState | null>(null);
  const [silent, setSilent] = useState(false);
  const streamAbort = useRef<AbortController | null>(null);
  const [loadedDemo, setLoadedDemo] = useState<string | null>(null);
  const [loadedDemoId, setLoadedDemoId] = useState<string | null>(null);
  const [loadingDemo, setLoadingDemo] = useState<string | null>(null);
  // Every voice message transcribed into the message box so far, with the server's receipt for
  // each; sent with the report so the server (not this page) says how the text was written.
  const [voice, setVoice] = useState<VoiceResult[]>([]);
  // A clip is being recorded or transcribed: its text is not in the message yet.
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [accessCode, setAccessCode] = useAccessCode();
  const hasAccess = accessCode.trim() !== "";
  const runsAs = effectiveEngine(engine, availability, hasAccess);
  // Dictation is a call to the Meta Model API, which a private run promises never to make.
  const privateRun = runsAs === "open-weights";
  const dictatedWithMeta = voice.some((clip) => !clip.demo);
  const formRef = useRef<HTMLFormElement>(null);
  const photosRef = useRef<HTMLDivElement>(null);
  const orderRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Leaving the page (or opening the case) stops reading the stream; the run itself carries on
  // on the server and is saved.
  useEffect(() => () => streamAbort.current?.abort(), []);

  useEffect(() => {
    if (!submitting || live?.phase !== "sending") return;
    const timer = setTimeout(() => setSilent(true), silenceMs);
    return () => clearTimeout(timer);
  }, [submitting, live?.phase, silenceMs]);

  // Object URLs made for a demo case's rows are released with the page (the dropzone releases
  // the ones it makes itself).
  useEffect(() => {
    const urls = seedUrls;
    return () => urls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function onVoiceTranscript(result: VoiceResult): void {
    setVoice((clips) => [...clips, result]);
    // Never overwrite what the customer already typed: the transcript goes after it.
    setMessage((current) => (current.trim() ? `${current.trimEnd()}\n\n${result.transcript}` : result.transcript));
    setErrors((e) => ({ ...e, message: undefined }));
    messageRef.current?.focus();
  }

  // The dropzone reports the whole list after every add and remove. Check what is there, so a
  // wrong type or an oversized file explains itself as soon as it is picked.
  function onFilesChange(next: File[]): void {
    setFiles(next);
    setErrors((e) => ({ ...e, photos: next.length === 0 ? undefined : (validatePhotos(next) ?? undefined) }));
  }

  async function loadScenario(s: DemoScenario): Promise<void> {
    setLoadingDemo(s.id);
    setServerError(null);
    setSavedCaseId(null);
    try {
      const loaded = await Promise.all(
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
      for (const url of seedUrls.current) URL.revokeObjectURL(url);
      const urls = loaded.map((file) => URL.createObjectURL(file));
      seedUrls.current = urls;
      setSeedItems(
        loaded.map((file, i) => ({ id: `demo-${s.id}-${i}`, name: file.name, size: file.size, file, preview: urls[i] })),
      );
      setDropzoneKey((k) => k + 1);
      setFiles(loaded);
      setOrderNumber(s.orderNumber);
      setEmail(s.email);
      setMessage(s.message);
      setVoice([]);
      setLanguage(s.language);
      setErrors({});
      setLoadedDemo(s.title);
      setLoadedDemoId(s.id);
      // On a phone the cards sit under the form: bring the filled form back into view.
      if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
        formRef.current?.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      }
    } catch {
      setErrors({ photos: "Could not load the demo photos. Attach your own photo instead." });
    } finally {
      setLoadingDemo(null);
    }
  }

  function focusField(field: keyof FieldErrors): void {
    if (field === "photos") photosRef.current?.querySelector("button")?.focus();
    else ({ orderNumber: orderRef, email: emailRef, message: messageRef })[field].current?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setServerError(null);
    setSavedCaseId(null);

    // The recording is still open, or its text has not come back: sending now would leave the
    // dictation out of a report that then claims to be typed.
    if (voiceBusy) {
      setServerError("Stop the recording and wait for the transcript before sending the report.");
      return;
    }
    if (privateRun && dictatedWithMeta) {
      setServerError(PRIVATE_DICTATION_ERROR);
      return;
    }

    const found = validateReport({ orderNumber, email, message }, files);
    setErrors(found);
    const firstInvalid = (["orderNumber", "email", "message", "photos"] as const).find((f) => found[f]);
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }

    // The server refuses it anyway (401); saying so here saves a round trip and a wrong guess.
    if (availability.accessCodeRequired && !hasAccess) {
      setServerError(ACCESS_CODE_NEEDED);
      document.getElementById("access-code")?.focus();
      return;
    }

    setSubmitting(true);
    setLive(initialLiveRun());
    setSilent(false);
    // The card turns into the live timeline: bring its top into view.
    formRef.current?.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    const abort = new AbortController();
    streamAbort.current = abort;
    // Once the case is done and its timeline is on screen, the form must not come back under it.
    let finished = false;
    try {
      const body = new FormData();
      body.set("orderNumber", orderNumber.trim());
      body.set("email", email.trim());
      body.set("message", message.trim());
      body.set("engine", engine);
      if (language !== "auto") body.set("language", language);
      if (voice.length > 0 && message.trim()) {
        // The transcripts and their receipts: the server checks the receipts and works out for
        // itself what was kept, changed or typed around them.
        body.set(
          "voiceNote",
          JSON.stringify({
            clips: voice.map((clip) => ({
              transcript: clip.transcript,
              durationMs: clip.durationMs,
              token: clip.voiceReceipt,
            })),
          }),
        );
      }
      for (const file of await Promise.all(files.map((file) => prepareImage(file)))) body.append("photos", file);

      // Asks for the progress stream; a server (or a proxy) that answers plain JSON still works.
      const res = await fetch("/api/reports", {
        method: "POST",
        body,
        headers: { ...accessHeaders(accessCode), Accept: `${NDJSON_CONTENT_TYPE}, application/json;q=0.5` },
        signal: abort.signal,
      });
      if (res.ok && res.body && (res.headers?.get?.("content-type") ?? "").includes("ndjson")) {
        finished = (await followRun(res.body, abort.signal)) !== "failed";
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        caseId?: string;
        message?: string;
        fields?: FieldErrors;
      } | null;
      if (res.ok && data?.caseId) {
        router.push(`/cases/${encodeURIComponent(data.caseId)}`);
        return;
      }
      if (data?.fields) {
        setErrors(data.fields);
        const first = (["orderNumber", "email", "message", "photos"] as const).find((f) => data.fields?.[f]);
        if (first) requestAnimationFrame(() => focusField(first));
      }
      setServerError(data?.message ?? "The report could not be processed.");
      if (data?.caseId) setSavedCaseId(data.caseId);
    } catch {
      if (abort.signal.aborted) return;
      setServerError("Could not reach the server. Check your connection and try again.");
    } finally {
      if (!finished) setSubmitting(false);
    }
  }

  /**
   * Read the run's NDJSON stream into the live timeline. Returns "done" when the case is done (the
   * timeline then stays, with its "Open the case" button), "lost" when the connection dropped after the
   * server had stored the report (the timeline stays too, with a link to the case and a warning not to
   * send the report again: its run is still going on the server), and "failed" when the run failed or
   * nothing was confirmed (the form comes back with the reason and, when the case was stored, a link to it).
   */
  async function followRun(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<"done" | "lost" | "failed"> {
    let state = initialLiveRun();
    const show = (next: LiveRunState) => {
      state = next;
      setLive(next);
    };
    try {
      for await (const event of readStreamEvents(body)) {
        show(reduceLiveRun(state, event));
        if (state.phase === "done" || state.phase === "error") break;
        // A DEMO MODE run is over in milliseconds: its steps are shown one after the other, not all at once.
        if (state.mock && demoPaceMs > 0 && PACED_EVENTS.has(event.type)) await sleep(demoPaceMs / 2);
      }
    } catch {
      if (signal.aborted) return "failed";
      // A read error mid-stream is a dropped connection: handled below like a stream that just ended.
    }
    if (state.phase === "done") return "done";
    if (state.phase === "error") {
      setServerError(state.error ?? "The report could not be processed.");
      if (state.caseId) setSavedCaseId(state.caseId);
      return "failed";
    }
    show(loseLiveRun(state));
    // Dropped before the server said it stored anything: not known to exist, so sending again is fair.
    if (!state.caseId) {
      setServerError(
        "The connection dropped before the server confirmed the report. It may not have been stored: look at the Cases page before sending it again.",
      );
      return "failed";
    }
    // Stored: the timeline stays and says so. No generic "press Send report again" here, that would
    // file the same report twice (a second case, a second real run, a second slot of the daily cap).
    return "lost";
  }

  // The live timeline replaces the form's fields while a report is sent, unless the server stays
  // silent so long that the answer is evidently not streamed (then the illustration below stands in).
  // It stays after the end ("done"), and after a dropped connection once the case is known to be stored
  // ("lost"): it is the page's answer then, not the form.
  const showLive =
    live !== null &&
    (live.phase === "done" ||
      (live.phase === "lost" && live.caseId !== null) ||
      (submitting && (live.phase === "running" || (live.phase === "sending" && !silent))));
  // The run is over, one way or the other, and the footer must say nothing about a run in progress.
  const ended = showLive && live !== null && (live.phase === "done" || live.phase === "lost");
  const working = submitting && !ended;

  /** Back to an empty form after a finished (or lost) run. Otherwise the only way out was to reload. */
  function fileAnother(): void {
    setLive(null);
    setSubmitting(false);
    setSilent(false);
    setServerError(null);
    setSavedCaseId(null);
    // Emptied, not kept: the same report sent twice would be two cases and two real runs.
    setOrderNumber("");
    setEmail("");
    setMessage("");
    setLanguage("auto");
    setVoice([]);
    setFiles([]);
    setSeedItems(undefined);
    setDropzoneKey((k) => k + 1);
    setErrors({});
    setLoadedDemo(null);
    setLoadedDemoId(null);
    formRef.current?.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    requestAnimationFrame(() => orderRef.current?.focus());
  }

  // While the timeline shows, it has its own polite status region (what each step found), and it knows
  // what really runs: a line here built from what the form expected would contradict it (it said "can take
  // a little while" over a DEMO MODE panel after a fallback). The line is for the fallback illustration only.
  const statusLine = showLive
    ? ""
    : submitting
      ? `The agent is looking up the order and reading the photos (${runsAs === "demo-mock" ? "demo mode" : "this can take a little while"}).`
      : loadedDemo
        ? `Demo case loaded: ${loadedDemo}. Review it, then send.`
        : "";

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_21.5rem] xl:gap-10">
      <div className="flex min-w-0 flex-col gap-3">
        <a
          href="#demo-cases"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-accent underline-offset-4 hover:underline lg:hidden"
        >
          Start from a demo case
          <ChevronDown aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
        </a>

        {/* The agent's working state: the whole card is ringed by a gold beam while it runs. */}
        <BorderBeam reveal={working} color="var(--gold-bright)" thickness={2} length={18} speed={4} className="rounded-2xl">
          <form
            ref={formRef}
            onSubmit={onSubmit}
            noValidate
            aria-label="Damage report"
            aria-busy={working}
            className="relative scroll-mt-6 md:scroll-mt-24 rounded-2xl border border-border bg-surface shadow-card"
          >
            {availability.accessCodeRequired && (
              // On a public deployment the code gates every new report, demo mode included, so a judge
              // must be told before filling the form (final review of 27 Oct 2026).
              <div
                role="note"
                data-testid="access-code-notice"
                className="flex items-start gap-3 rounded-t-2xl border-b border-border bg-accent-soft px-5 py-4 text-sm sm:px-8"
              >
                <KeyRound aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
                <div>
                  <p className="font-semibold text-foreground">Judges: use the access code from the submission to run the real agent.</p>
                  <p className="mt-1 leading-6 text-muted">
                    Without it this public demo accepts no new report, not even in demo mode. The recorded runs on the{" "}
                    <Link href="/" className="font-medium text-accent underline underline-offset-2">
                      Cases page
                    </Link>{" "}
                    are real runs of the agent and need no code.
                  </p>
                </div>
              </div>
            )}

            <div inert={submitting} hidden={showLive} className="divide-y divide-border">
              <Section id="order" step={1} title="Order & customer" description="How the agent finds the order. Fictitious data only.">
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
              </Section>

              <Section id="message-section" step={2} title="Message" description="What the customer wrote, or said out loud.">
                <Field
                  id="message"
                  label="Message from the customer"
                  error={errors.message}
                  hint="Type it or record it. Any language. The reply is written in the customer's language."
                >
                  <div
                    className={cn(
                      "overflow-hidden rounded-xl border bg-surface transition-[border-color,box-shadow] duration-150 focus-within:border-ink focus-within:ring-2 focus-within:ring-ink/15",
                      errors.message ? "border-danger" : "border-border-strong/70 hover:border-border-strong",
                    )}
                  >
                    <textarea
                      id="message"
                      ref={messageRef}
                      value={message}
                      onChange={(e) => {
                        setMessage(e.target.value);
                        // Emptied and retyped: it is a typed message now, not a dictated one.
                        if (e.target.value.trim() === "") setVoice([]);
                      }}
                      rows={5}
                      placeholder="My vase arrived broken…"
                      aria-invalid={Boolean(errors.message)}
                      aria-describedby={errors.message ? "message-error" : "message-hint"}
                      className="block min-h-32 w-full resize-y bg-transparent px-3.5 py-3 text-[0.9375rem] leading-6 text-foreground placeholder:text-muted focus-visible:outline-none"
                    />
                    <div className="border-t border-border bg-surface-muted px-3 py-2.5">
                      {privateRun ? (
                        <div className="flex flex-col gap-2">
                          <p className="flex items-start gap-2 text-xs leading-5 text-muted">
                            <Lock aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                            Voice input uses the Meta API, which is unavailable in private mode.
                          </p>
                          {dictatedWithMeta && <FieldError id="voice-private-error">{PRIVATE_DICTATION_ERROR}</FieldError>}
                        </div>
                      ) : (
                        <VoiceRecorder
                          language={language}
                          accessCode={accessCode}
                          disabled={submitting}
                          onTranscript={onVoiceTranscript}
                          onBusyChange={setVoiceBusy}
                        />
                      )}
                    </div>
                  </div>
                </Field>

                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-foreground">Customer language</span>
                  <SegmentedControl
                    label="Customer language"
                    options={LANGUAGE_OPTIONS}
                    value={language}
                    onValueChange={(value) => setLanguage(value as LanguageChoice)}
                    className="w-full sm:w-auto [&>div]:flex-1 [&_button]:min-h-11 [&_button]:flex-1 sm:[&_button]:min-w-28"
                  />
                </div>
              </Section>

              <Section
                id="photos-section"
                step={3}
                title="Photos of the damage"
                description={`1 to ${MAX_PHOTOS} photos, JPEG, PNG or WebP, ${MAX_PHOTO_BYTES / (1024 * 1024)} MB each. Resized in your browser before upload.`}
              >
                <div ref={photosRef} className="flex flex-col gap-2.5">
                  <FileDropzone
                    key={dropzoneKey}
                    accept={ACCEPTED_PHOTO_TYPES.join(",")}
                    maxFiles={MAX_PHOTOS}
                    maxSize={MAX_PHOTO_BYTES}
                    defaultItems={seedItems}
                    onFilesChange={onFilesChange}
                    compactAt={1}
                    label="Add photos of the damage"
                    description="Drop them here, paste, or choose from your device"
                    note={`JPEG, PNG or WebP · up to ${MAX_PHOTOS} photos · ${MAX_PHOTO_BYTES / (1024 * 1024)} MB each`}
                    dropLabel="Drop to add photos"
                  />
                  {errors.photos && <FieldError id="photos-error">{errors.photos}</FieldError>}
                </div>
              </Section>

              <Section
                id="engine"
                step={4}
                title="Engine"
                description="Which model reads the report. The line below says what it will really run as."
              >
                <EngineSwitch value={engine} onChange={setEngine} availability={availability} hasAccess={hasAccess} />
              </Section>

              {availability.accessCodeRequired && (
                <Section id="access" step={5} title="Judges' access" description="This public demo asks for the code from the submission.">
                  <AccessCodeField
                    id="access-code"
                    value={accessCode}
                    onChange={setAccessCode}
                    hint="Needed to send a report or dictate one (the real engines and demo mode alike). Never type real customer data here."
                  />
                </Section>
              )}
            </div>

            {showLive && live && (
              <LiveRun
                state={live}
                expectedEngine={runsAs}
                onOpen={(id) => router.push(`/cases/${encodeURIComponent(id)}`)}
              />
            )}

            <div className="flex flex-col gap-4 rounded-b-2xl border-t border-border bg-surface-muted px-5 py-5 sm:px-8">
              {serverError && (
                <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
                  <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <p className="font-medium">{serverError}</p>
                    <p className="text-xs leading-5">Your answers and photos are still here. Fix what is flagged, then press Send report again.</p>
                    {savedCaseId && (
                      <p>
                        <Link href={`/cases/${encodeURIComponent(savedCaseId)}`} className="font-semibold underline underline-offset-2">
                          Open the saved case
                        </Link>
                      </p>
                    )}
                  </div>
                </div>
              )}
              {ended ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-5 text-muted">
                    Nothing is sent to a customer or a carrier. You review the case, then approve it.
                  </p>
                  <button type="button" onClick={fileAnother} className={BUTTON_QUIET}>
                    File another report
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p role="status" className="text-sm text-foreground">
                      {statusLine}
                    </p>
                    <p className="text-xs leading-5 text-muted">
                      Nothing is sent to a customer or a carrier. You review the case, then approve it.
                    </p>
                  </div>
                  <ShimmerButton
                    type="submit"
                    disabled={submitting}
                    aria-busy={submitting}
                    shimmerColor="var(--gold-bright)"
                    shimmerDuration="3.2s"
                    background="var(--ink)"
                    borderRadius="0.75rem"
                    className={cn(
                      "min-h-12 gap-2 px-7 text-[0.9375rem] font-semibold tracking-tight shadow-raised",
                      "enabled:hover:-translate-y-px disabled:cursor-wait disabled:opacity-80",
                      "motion-reduce:[&>div:first-of-type]:hidden",
                    )}
                  >
                    {submitting ? (
                      <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={2} />
                    ) : null}
                    {submitting ? "Investigating…" : "Send report"}
                    {!submitting && <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={2} />}
                  </ShimmerButton>
                </div>
              )}
            </div>

            {/* The illustration is only the fallback: when no stream is arriving. It says it is one. */}
            {submitting && !showLive && <AgentWorking engine={runsAs} />}
          </form>
        </BorderBeam>
      </div>

      <aside id="demo-cases" aria-labelledby="demo-title" className="flex scroll-mt-6 md:scroll-mt-24 flex-col gap-4">
        <div>
          <h2 id="demo-title" className="font-display text-2xl tracking-tight text-foreground">
            Demo cases
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-muted">
            One click fills the form with a fictitious customer and an AI-generated demo image. Then press Send report.
          </p>
        </div>
        <ul className="flex flex-col gap-3">
          {DEMO_SCENARIOS.map((s) => (
            <li key={s.id}>
              <ScenarioCard
                scenario={s}
                selected={loadedDemoId === s.id}
                loading={loadingDemo === s.id}
                disabled={loadingDemo !== null || submitting}
                onSelect={() => void loadScenario(s)}
              />
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
