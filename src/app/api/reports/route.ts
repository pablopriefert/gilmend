import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runAgent } from "@/lib/agent/run-agent";
import { hasModelKey, resolveEngine } from "@/lib/config";
import { parseVoiceNote } from "@/lib/voice/note";
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
import { accessCodeRequired, hasValidAccessCode } from "../_lib/access";
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

const ENGINES: readonly Engine[] = ["muse-spark-1.3", "open-weights", "demo-mock"];
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

  const requested = text(form, "engine");
  const requestedEngine: Engine = (ENGINES as readonly string[]).includes(requested)
    ? (requested as Engine)
    : "muse-spark-1.3";
  // Without credentials this resolves to "demo-mock": the case then says so (DEMO MODE).
  let engine = resolveEngine(requestedEngine);
  // A real engine spends credits or wakes a GPU. On a public deployment (access code set) it
  // needs the code, and it is capped per day; otherwise the report runs in labelled DEMO MODE.
  let fellBackReason: "no_credentials" | "access_code" | "daily_limit" | null =
    engine !== requestedEngine ? "no_credentials" : null;
  if (engine !== "demo-mock") {
    if (accessCodeRequired() && !hasValidAccessCode(request)) {
      engine = "demo-mock";
      fellBackReason = "access_code";
    } else if (!takeRealRun(realRunsPerDay())) {
      engine = "demo-mock";
      fellBackReason = "daily_limit";
    }
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
        return toStoredPath(target);
      }),
    );
  } catch (err) {
    console.error("[damage-desk] could not store the uploaded photos:", err instanceof Error ? err.message : err);
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
    voiceNote: parseVoiceNote(form.get("voiceNote"), hasModelKey()),
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
    console.error("[damage-desk] could not save the new case:", err instanceof Error ? err.message : err);
    return errorResponse(500, "storage_failed", "Could not store the report on the server.");
  }

  let result: CaseRecord;
  try {
    result = await runAgent(report, { engine, caseId });
  } catch (err) {
    // runAgent is meant never to throw; if it does, keep the report as a "new" case a human
    // can open, with the failure on the trace.
    console.error("[damage-desk] agent run failed:", err instanceof Error ? err.message : err);
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
    return errorResponse(502, "agent_failed", "The agent could not process this report.", { caseId });
  }

  // runAgent may or may not persist; saving is idempotent (insert or replace by id).
  let saved: CaseRecord;
  try {
    saved = await saveCase(result);
  } catch (err) {
    console.error("[damage-desk] could not save the case:", err instanceof Error ? err.message : err);
    return errorResponse(500, "storage_failed", "The case was processed but could not be saved.");
  }

  return Response.json(
    {
      caseId: saved.id,
      status: saved.status,
      engine: saved.engine,
      requestedEngine,
      // True when the server could not honour the requested engine (no key / no endpoint,
      // no access code on a public deployment, daily ceiling of real runs reached).
      fellBack: saved.engine !== requestedEngine,
      fellBackReason: saved.engine !== requestedEngine ? fellBackReason : null,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
