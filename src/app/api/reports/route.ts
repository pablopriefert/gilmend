import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { after } from "next/server";
import {
  NDJSON_CONTENT_TYPE,
  type AgentEventSink,
  type RunOutcomeFields,
  type StreamEvent,
} from "@/lib/agent/events";
import { runAgent } from "@/lib/agent/run-agent";
import { resolveEngine } from "@/lib/config";
import { parseVoiceNote } from "@/lib/voice/note";
import { persistRuntimeFile } from "@/lib/storage/runtime-files";
import { saveCase } from "@/lib/store/cases";
import type { CaseRecord, DamageReport, Engine } from "@/lib/types";
import {
  IMAGE_EXTENSION,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  sniffImageKind,
  validateReport,
  type FieldErrors,
  type ImageKind,
} from "@/components/report-validation";
import { requireAccessCode } from "../_lib/access";
import { detectLanguage } from "../_lib/language";
import { clientKey, rateLimit, realRunsPerDay, takeRealRun } from "../_lib/rate-limit";
import { errorResponse } from "../_lib/responses";
import { runtimeDir, toStoredPath } from "../_lib/runtime-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A real run is up to 8 model turns with photos: give it room, and let runAgent's own time
// budget (90 s) end a slow run in a "needs a human" case before the platform kills the
// function and the report is lost. 120 s is within Vercel's limit with Fluid Compute (the
// default on new projects); a plan without it caps at 60 s and the build says so.
export const maxDuration = 120;

const ENGINES: readonly Engine[] = ["muse-spark-1.3", "open-weights", "openrouter", "demo-mock"];
// Each accepted report can spend model credits, so the public demo URL gets a modest cap per
// client; takeRealRun adds a global daily ceiling on real runs. Local development is not
// limited: all local requests share one bucket and rehearsing the video would hit it.
const RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };
// 3 photos at the limit plus form fields and multipart framing.
const MAX_BODY_BYTES = MAX_PHOTOS * MAX_PHOTO_BYTES + 256 * 1024;

// Duck-typed instead of `instanceof File`: the File class a runtime hands back from
// formData() is not always the global one (test environments, edge runtimes).
function isUploadedFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.arrayBuffer === "function" &&
    typeof value.size === "number"
  );
}

function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

/**
 * POST /api/reports: simulates an inbound customer e-mail or chat message.
 * multipart/form-data with orderNumber, email, message, optional language ("en", "fr", or
 * "auto") and engine, and 1 to 3 `photos`. Stores the photos under data/runtime/uploads/,
 * runs the agent, saves the resulting case and answers `{ caseId, status, engine }`.
 * Nothing is ever sent to anyone: the case waits in "needs_review" for a human click.
 * When DAMAGE_DESK_ACCESS_CODE is set (a public deployment) the `x-access-code` header must carry
 * it, whatever the engine: else 401, and 429 after too many wrong codes.
 */
export async function POST(request: Request): Promise<Response> {
  const limited =
    process.env.NODE_ENV === "development"
      ? { ok: true, retryAfterSeconds: 0 }
      : rateLimit(clientKey(request), RATE_LIMIT);
  if (!limited.ok) {
    const res = errorResponse(429, "rate_limited", "Too many reports in a short time. Try again in a few minutes.");
    res.headers.set("Retry-After", String(limited.retryAfterSeconds));
    return res;
  }

  // On a public deployment (access code set) NO new report is taken without the code, demo mode
  // included: the case list is public, so an anonymous report would be shown to the judges.
  // Refused before the body is read. Locally (no code set) this does nothing.
  const refused = requireAccessCode(
    request,
    "Filing a report on this public demo needs the access code from the submission. The recorded runs on the Cases page show the real agent without it.",
  );
  if (refused) return refused;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse(413, "too_large", `The upload is too large (max ${MAX_PHOTOS} photos of 8 MB each).`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "invalid_form", "Send the report as multipart/form-data.");
  }

  const fields = {
    orderNumber: text(form, "orderNumber"),
    email: text(form, "email"),
    message: text(form, "message"),
  };
  const files = form.getAll("photos").filter(isUploadedFile);

  const errors: FieldErrors = validateReport(fields, files);
  if (Object.keys(errors).length > 0) {
    return errorResponse(400, "validation", "The report is not valid.", { fields: errors });
  }

  // The MIME type is only what the client claims: read the real signature of each file.
  const buffers: { bytes: Buffer; kind: ImageKind }[] = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = sniffImageKind(bytes);
    if (!kind) {
      return errorResponse(400, "validation", "The report is not valid.", {
        fields: { photos: `"${file.name}" is not a real JPEG, PNG or WebP image.` } satisfies FieldErrors,
      });
    }
    buffers.push({ bytes, kind });
  }

  // Read before the engine is resolved: whether the message was really dictated (and so went to
  // the Model API) decides whether a private run is allowed, and must be known before a daily
  // slot of real runs is taken.
  const voiceNote = parseVoiceNote(form.get("voiceNote"), fields.message.trim());

  const requested = text(form, "engine");
  const requestedEngine: Engine = (ENGINES as readonly string[]).includes(requested)
    ? (requested as Engine)
    : "muse-spark-1.3";
  // Without credentials this resolves to "demo-mock": the case then says so (DEMO MODE).
  let engine = resolveEngine(requestedEngine);
  // "A private run never calls the Model API": dictation is a call to it (Muse Voice Transcribe),
  // so a message that was really transcribed there cannot be filed as a private run. Refused
  // rather than silently labelled: the customer decides to retype it or to pick another engine.
  if (engine === "open-weights" && voiceNote && !voiceNote.demo) {
    return errorResponse(
      400,
      "voice_not_private",
      "This message was dictated with the Meta Model API, so it cannot run privately. Type it instead, or pick another engine.",
    );
  }
  // A real engine spends credits or wakes a GPU: it is capped per day, and beyond the ceiling the
  // report runs in labelled DEMO MODE. (The access code was checked at the top of the route.)
  let fellBackReason: "no_credentials" | "daily_limit" | null = engine !== requestedEngine ? "no_credentials" : null;
  if (engine !== "demo-mock" && !takeRealRun(realRunsPerDay())) {
    engine = "demo-mock";
    fellBackReason = "daily_limit";
  }

  const languageField = text(form, "language").trim().toLowerCase();
  const language = /^[a-z]{2}$/.test(languageField) ? languageField : detectLanguage(fields.message);

  const reportId = randomUUID();
  const uploadDir = path.join(runtimeDir(), "uploads", reportId);
  let photoPaths: string[];
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    photoPaths = await Promise.all(
      buffers.map(async ({ bytes, kind }, i) => {
        const target = path.join(uploadDir, `photo-${i + 1}.${IMAGE_EXTENSION[kind]}`);
        await fs.writeFile(target, bytes);
        // With a shared store configured the photo must outlive this instance (the case page
        // may be served by another one). Without one this does nothing.
        await persistRuntimeFile(target);
        return toStoredPath(target);
      }),
    );
  } catch (err) {
    console.error("[gilmend] could not store the uploaded photos:", err instanceof Error ? err.message : err);
    return errorResponse(500, "storage_failed", "Could not store the photos on the server.");
  }

  const report: DamageReport = {
    id: reportId,
    receivedAt: new Date().toISOString(),
    customerEmail: fields.email.trim(),
    orderNumber: fields.orderNumber.trim(),
    message: fields.message.trim(),
    photos: photoPaths,
    language,
    // Present when the message was dictated: labelled on the case and told to the agent.
    voiceNote,
  };

  // The case exists BEFORE the agent runs, as "new": if the function is cut by the platform
  // or the agent crashes, the photos and the report are not orphaned and a human can open it.
  // runAgent then produces the final case under the same id.
  const caseId = `case_${reportId}`;
  const startedAt = new Date().toISOString();
  const pending: CaseRecord = {
    id: caseId,
    report,
    order: null,
    assessment: null,
    claim: null,
    decision: null,
    evidence: [],
    document: null,
    status: "new",
    engine,
    trace: [{ step: "Report received. The agent has not finished yet.", at: startedAt }],
    createdAt: startedAt,
    updatedAt: startedAt,
  };
  try {
    await saveCase(pending);
  } catch (err) {
    console.error("[gilmend] could not save the new case:", err instanceof Error ? err.message : err);
    return errorResponse(500, "storage_failed", "Could not store the report on the server.");
  }

  // What the page needs to know about the engine, whatever the answer format.
  const engineFields = (actual: Engine) => ({
    engine: actual,
    requestedEngine,
    // True when the server could not honour the requested engine (no key / no endpoint,
    // daily ceiling of real runs reached).
    fellBack: actual !== requestedEngine,
    fellBackReason: actual !== requestedEngine ? fellBackReason : null,
  });

  /**
   * The run itself, identical for both answer formats: agent, then save, never throwing. `onEvent`
   * is given only to a streaming client; without it runAgent is called exactly as before.
   */
  const run = async (onEvent?: AgentEventSink): Promise<RunResult> => {
    let result: CaseRecord;
    try {
      result = await runAgent(report, { engine, caseId, ...(onEvent ? { onEvent } : {}) });
    } catch (err) {
      // runAgent is meant never to throw; if it does, keep the report as a "new" case a human
      // can open, with the failure on the trace.
      console.error("[gilmend] agent run failed:", err instanceof Error ? err.message : err);
      const failedAt = new Date().toISOString();
      try {
        await saveCase({
          ...pending,
          trace: [...pending.trace, { step: "The agent run failed: report stored without an investigation.", at: failedAt }],
          updatedAt: failedAt,
        });
      } catch {
        // The store went away between the two writes: the first save still holds the report.
      }
      return {
        ok: false,
        status: 502,
        code: "agent_failed",
        message: "The agent could not process this report.",
        extra: { caseId },
      };
    }

    // runAgent may or may not persist; saving is idempotent (insert or replace by id).
    try {
      return { ok: true, saved: await saveCase(result) };
    } catch (err) {
      console.error("[gilmend] could not save the case:", err instanceof Error ? err.message : err);
      return {
        ok: false,
        status: 500,
        code: "storage_failed",
        message: "The case was processed but could not be saved.",
        extra: {},
      };
    }
  };

  if (!wantsStream(request)) {
    const outcome = await run();
    if (!outcome.ok) return errorResponse(outcome.status, outcome.code, outcome.message, outcome.extra);
    return Response.json(
      { caseId: outcome.saved.id, status: outcome.saved.status, ...engineFields(outcome.saved.engine) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  }

  return streamRun({ caseId, engineAtStart: engine, engineFields, run });
}

type RunResult =
  | { ok: true; saved: CaseRecord }
  | { ok: false; status: number; code: string; message: string; extra: Record<string, unknown> };

/** The client asks for progress with `Accept: application/x-ndjson` (or `?stream=1`); else the JSON answer. */
function wantsStream(request: Request): boolean {
  if ((request.headers.get("accept") ?? "").toLowerCase().includes(NDJSON_CONTENT_TYPE)) return true;
  return new URL(request.url).searchParams.get("stream") === "1";
}

// Idle proxies cut a connection that says nothing for a while, and one model turn can take 45 s.
const PING_EVERY_MS = 10_000;

/**
 * Answer with NDJSON (one JSON object per line, see StreamEvent): `accepted`, then the agent's
 * events as they happen, then `done` (or `error`). The case is saved exactly as in the JSON
 * answer, BEFORE `done` is sent, and `done` carries its id. If the browser leaves (a closed tab, a
 * dropped connection) the run is not interrupted: it finishes and is saved, only the sending stops.
 */
function streamRun({
  caseId,
  engineAtStart,
  engineFields,
  run,
}: {
  caseId: string;
  engineAtStart: Engine;
  engineFields: (actual: Engine) => Omit<RunOutcomeFields, "caseId">;
  run: (onEvent: AgentEventSink) => Promise<RunResult>;
}): Response {
  const encoder = new TextEncoder();
  const began = Date.now();
  let open = true;
  let ping: ReturnType<typeof setInterval> | undefined;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

  const send = (event: StreamEvent) => {
    if (!open || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      // The reader is gone: stop sending, keep running.
      open = false;
    }
  };
  const endStream = () => {
    clearInterval(ping);
    if (!open) return;
    open = false;
    try {
      controllerRef?.close();
    } catch {
      // Already closed by the reader.
    }
  };

  let finished: Promise<void> = Promise.resolve();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      send({ type: "accepted", t: 0, caseId, ...engineFields(engineAtStart) });
      ping = setInterval(() => send({ type: "ping", t: Date.now() - began }), PING_EVERY_MS);
      ping.unref?.();
      finished = run((event) => send(event))
        .then((outcome) => {
          if (outcome.ok) {
            send({ type: "done", t: Date.now() - began, caseId: outcome.saved.id, status: outcome.saved.status, ...engineFields(outcome.saved.engine) });
          } else {
            // The report was stored as "new" before the run, so its id is always worth giving.
            send({ type: "error", t: Date.now() - began, code: outcome.code, message: outcome.message, caseId });
          }
        })
        .catch((err) => {
          console.error("[gilmend] streamed run failed:", err instanceof Error ? err.message : err);
          send({ type: "error", t: Date.now() - began, code: "internal_error", message: "The run failed unexpectedly.", caseId });
        })
        .finally(endStream);
    },
    cancel() {
      // The browser went away. `finished` keeps going (and is kept alive below).
      open = false;
      clearInterval(ping);
    },
  });

  // On a serverless platform a function may be frozen once the response is over: keep it alive
  // until the case is saved, even when the browser has left. Outside a request (tests) there is
  // no scope to register with; the promise then simply runs on.
  try {
    after(() => finished);
  } catch {
    // not in a request scope
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": `${NDJSON_CONTENT_TYPE}; charset=utf-8`,
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
