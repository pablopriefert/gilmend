"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown, FlaskConical, LoaderCircle, MessageSquareReply, RefreshCw, TriangleAlert } from "lucide-react";
import { MAX_FOLLOW_UP_MESSAGE_CHARS, MAX_FOLLOW_UP_PHOTOS, type MissingInfo } from "@/lib/rounds";
import type { Engine, EngineDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AccessCodeField, accessHeaders } from "./access-code";
import FileDropzone, { type FileDropzoneItem } from "./arc/file-dropzone/file-dropzone";
import { useReviewAccess } from "./case-review-panel";
import { useCaseToast } from "./case/toast-host";
import { BUTTON_PRIMARY, BUTTON_QUIET, Panel, Pill } from "./case/ui";
import { DEMO_FOLLOW_UP } from "./demo-scenarios";
import { EngineBadge } from "./engine-badge";
import { DECISION_LABEL } from "./format";
import { prepareImage } from "./image-prep";
import { AgentWorking } from "./report/agent-working";
import { Field, FieldError, INPUT_CLASS } from "./report/form-primitives";
import {
  ACCEPTED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  validateFollowUp,
  type FieldErrors,
} from "./report-validation";

/** What the server answers to a follow-up (src/app/api/cases/[id]/follow-up/route.ts). */
interface FollowUpResponse {
  round?: number;
  decision?: keyof typeof DECISION_LABEL | null;
  fellBack?: boolean;
  message?: string;
  error?: string;
  fields?: FieldErrors;
}

/**
 * "The customer replied": the merchant adds what the customer sent back (words, new photos, or a
 * corrected order number) and the agent runs again on this same case, with everything it knew
 * (resumeAgent). Shown on a case whose decision is "ask for more photos", or that needs a human
 * because the photos cannot be read or the order cannot be found (followUpAvailability): the page
 * decides, the server checks it again.
 *
 * Nothing here is sent to the customer: the agent drafts a new decision, claim and reply, and the
 * merchant reviews round 2 like round 1. The access code is the one of the review card (typed once
 * for the page). On the blurry-lamp demo case a button loads a sharp photo and a short message into
 * the form; the case page then labels that reply "simulated".
 */
export function FollowUpPanel({
  caseId,
  round,
  missing,
  asked,
  orderMissing,
  runsAs,
  demoReply,
  index = 1,
}: {
  caseId: string;
  /** The round the case is in now: sent with the reply, so a stale page is refused (409), not run twice. */
  round: number;
  missing: MissingInfo[];
  /** The reply drafted for the customer in the current round: what they were asked. */
  asked: string;
  /** The case has no order yet: the customer may have given the right number. */
  orderMissing: boolean;
  /** What the server will really run the agent on (it can be the labelled mock when no key is set). */
  runsAs: { engine: Engine; detail?: EngineDetail };
  /** The blurry-lamp demo case: offer the "simulate the customer's reply" button. */
  demoReply: boolean;
  index?: number;
}) {
  const router = useRouter();
  const notify = useCaseToast();
  const access = useReviewAccess();
  const baseId = useId();
  const messageId = `${baseId}-message`;
  const orderId = `${baseId}-order`;
  const codeId = `${baseId}-code`;
  const askedId = `${baseId}-asked`;

  const [message, setMessage] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  // Loading the demo reply replaces the dropzone's rows: it is remounted (new key) with them as its start.
  const [dropzoneKey, setDropzoneKey] = useState(0);
  const [seedItems, setSeedItems] = useState<FileDropzoneItem[] | undefined>(undefined);
  const seedUrls = useRef<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoLoaded, setDemoLoaded] = useState(false);
  const nextRound = round + 1;

  useEffect(() => {
    const urls = seedUrls;
    return () => urls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const wantsPhotos = missing.includes("photos");
  const wantsOrder = missing.includes("order") && orderMissing;
  const lead = wantsPhotos && wantsOrder
    ? "The agent asked for more photos and could not find the order."
    : wantsOrder
      ? "The agent could not find the order."
      : "The agent asked the customer for more photos.";

  function onFilesChange(next: File[]): void {
    setFiles(next);
    setErrors((e) => ({ ...e, photos: validateFollowUp({ message, orderNumber }, next).photos }));
  }

  async function loadDemoReply(): Promise<void> {
    setLoadingDemo(true);
    setServerError(null);
    try {
      const res = await fetch(DEMO_FOLLOW_UP.photoSrc);
      if (!res.ok) throw new Error(`demo photo answered ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], DEMO_FOLLOW_UP.fileName, { type: blob.type || "image/webp" });
      for (const url of seedUrls.current) URL.revokeObjectURL(url);
      const url = URL.createObjectURL(file);
      seedUrls.current = [url];
      setSeedItems([{ id: "demo-reply-0", name: file.name, size: file.size, file, preview: url }]);
      setDropzoneKey((k) => k + 1);
      setFiles([file]);
      setMessage(DEMO_FOLLOW_UP.message);
      setErrors({});
      setDemoLoaded(true);
    } catch {
      setErrors({ photos: "Could not load the demo photo. Add a photo of your own instead." });
    } finally {
      setLoadingDemo(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setServerError(null);

    const found = validateFollowUp({ message, orderNumber: wantsOrder ? orderNumber : "" }, files);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = found.message ? messageId : found.orderNumber ? orderId : null;
      if (first) document.getElementById(first)?.focus();
      return;
    }
    if (access.accessCodeRequired && access.accessCode.trim() === "") {
      setServerError("Enter the access code from the submission to add the customer's reply. This public demo takes none without it.");
      document.getElementById(codeId)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData();
      body.set("message", message.trim());
      body.set("round", String(round));
      if (wantsOrder && orderNumber.trim()) body.set("orderNumber", orderNumber.trim());
      for (const file of await Promise.all(files.map((f) => prepareImage(f)))) body.append("photos", file);

      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/follow-up`, {
        method: "POST",
        body,
        headers: accessHeaders(access.accessCode),
      });
      const data = (await res.json().catch(() => null)) as FollowUpResponse | null;
      if (res.status === 401 && data?.error === "access_code_required") access.setCodeRefused(true);
      if (!res.ok) {
        if (data?.fields) setErrors(data.fields);
        setServerError(data?.message ?? "The reply could not be processed.");
        return;
      }
      access.setCodeRefused(false);
      const outcome = data?.decision ? DECISION_LABEL[data.decision] : "no decision";
      notify({
        title: `Round ${data?.round ?? nextRound} is ready`,
        description: data?.fellBack
          ? `The agent ran in DEMO MODE (the engine of this case is not configured here). Decision: ${outcome}.`
          : `The agent ran again on the same case. Decision: ${outcome}.`,
      });
      // Re-render the server side: the new round, decision, claim, trace. The panel remounts for the new round.
      router.refresh();
    } catch {
      setServerError("Could not reach the server. Check your connection and try again. Nothing was changed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel
      id="follow-up-title"
      title="The customer replied"
      icon={MessageSquareReply}
      index={index}
      className="relative overflow-hidden"
      action={<Pill icon={RefreshCw}>Starts round {nextRound}</Pill>}
    >
      <form onSubmit={onSubmit} noValidate aria-busy={submitting} data-testid="follow-up-form" className="flex flex-col gap-5">
        <p className="text-sm leading-relaxed text-ink-soft">
          {lead} When the customer answers, add their reply here: the agent runs again on this same case with everything it
          already knows, and round {round} stays on the page. Nothing is sent to the customer.
        </p>

        {asked.trim() !== "" && (
          <details className="group rounded-xl border border-border bg-surface-muted/70">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
              What the customer was asked
              <ChevronDown aria-hidden="true" className="h-4 w-4 text-muted transition-transform duration-200 group-open:rotate-180" strokeWidth={1.75} />
            </summary>
            <p id={askedId} className="whitespace-pre-wrap border-t border-border px-3.5 py-3 text-sm leading-relaxed text-ink-soft">
              {asked}
            </p>
          </details>
        )}

        {demoReply && (
          <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border-strong bg-surface-muted/50 p-3.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button type="button" className={BUTTON_QUIET} disabled={loadingDemo || submitting} onClick={() => void loadDemoReply()}>
                {loadingDemo ? (
                  <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:hidden" strokeWidth={2} />
                ) : (
                  <FlaskConical aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                )}
                {loadingDemo ? "Loading the demo reply…" : "Demo: simulate the customer's reply"}
              </button>
              <span className="text-xs leading-5 text-muted">
                Loads a sharp photo of the lamp and a short message into the form.
              </span>
            </div>
            <p className="text-xs leading-5 text-muted">
              The photo is generated with Meta&apos;s Muse Image (data/photos/README.md): it shows a lamp like the one in
              the blurry photo, not the same pixels, and the case will say the reply is simulated.
            </p>
          </div>
        )}

        {wantsOrder && (
          <Field
            id={orderId}
            label="Corrected order number"
            error={errors.orderNumber}
            hint="Only if the customer gave a different order number. Leave empty to keep the one they first wrote."
          >
            <input
              id={orderId}
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="#1001"
              autoComplete="off"
              aria-invalid={Boolean(errors.orderNumber)}
              aria-describedby={errors.orderNumber ? `${orderId}-error` : `${orderId}-hint`}
              className={INPUT_CLASS}
            />
          </Field>
        )}

        <Field
          id={messageId}
          label="What the customer wrote"
          error={errors.message}
          hint={`Optional when you add photos. Up to ${MAX_FOLLOW_UP_MESSAGE_CHARS} characters. Treated as the customer's words, never as instructions.`}
        >
          <textarea
            id={messageId}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              if (errors.message) setErrors((prev) => ({ ...prev, message: undefined }));
            }}
            rows={4}
            maxLength={MAX_FOLLOW_UP_MESSAGE_CHARS + 200}
            placeholder="Here is a sharper photo…"
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? `${messageId}-error` : `${messageId}-hint`}
            className={cn(
              "block min-h-28 w-full resize-y rounded-xl border bg-surface px-3.5 py-3 text-[0.9375rem] leading-6 text-foreground placeholder:text-muted transition-[border-color,box-shadow] duration-150 focus:border-ink focus-visible:outline-none focus:ring-2 focus:ring-ink/15",
              errors.message ? "border-danger" : "border-border-strong/70 hover:border-border-strong",
            )}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <span id={`${baseId}-photos-label`} className="text-sm font-medium text-foreground">
            New photos
          </span>
          <FileDropzone
            key={dropzoneKey}
            accept={ACCEPTED_PHOTO_TYPES.join(",")}
            maxFiles={MAX_FOLLOW_UP_PHOTOS}
            maxSize={MAX_PHOTO_BYTES}
            defaultItems={seedItems}
            onFilesChange={onFilesChange}
            compactAt={1}
            label="Add the customer's new photos"
            description="Drop them here, paste, or choose from your device"
            note={`JPEG, PNG or WebP · up to ${MAX_FOLLOW_UP_PHOTOS} photos · ${MAX_PHOTO_BYTES / (1024 * 1024)} MB each`}
            dropLabel="Drop to add photos"
          />
          {errors.photos && <FieldError id={`${baseId}-photos-error`}>{errors.photos}</FieldError>}
        </div>

        {(access.accessCodeRequired || access.codeRefused) && (
          <div className="rounded-xl border border-border bg-surface-muted p-3.5">
            <AccessCodeField
              id={codeId}
              value={access.accessCode}
              onChange={access.setAccessCode}
              hint="This public demo only lets people with the access code run the agent again. It is the same code as in the review card."
            />
          </div>
        )}

        {serverError && (
          <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger-soft px-3.5 py-3 text-sm text-danger">
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
            <span>{serverError}</span>
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs leading-5 text-muted">
            Will run on
            <EngineBadge engine={runsAs.engine} detail={runsAs.detail} compact />
            {runsAs.engine === "demo-mock" && <span>DEMO MODE: scripted answers, no model is called.</span>}
          </p>
          <p role="status" className="text-sm text-foreground">
            {submitting
              ? `The agent is re-reading the case (round ${nextRound}).`
              : demoLoaded
                ? "Demo reply loaded. Review it, then run the agent again."
                : ""}
          </p>
          <button type="submit" disabled={submitting} aria-busy={submitting} className={cn(BUTTON_PRIMARY, "w-full sm:w-auto sm:self-start")}>
            {submitting ? (
              <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:hidden" strokeWidth={2} />
            ) : (
              <RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
            )}
            {submitting ? "Running the agent…" : `Run the agent again (round ${nextRound})`}
          </button>
        </div>
      </form>
      {submitting && <AgentWorking engine={runsAs.engine} variant="follow-up" />}
    </Panel>
  );
}
