import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resumeAgent } from "@/lib/agent/run-agent";
import { resolveEngine } from "@/lib/config";
import { resolveDemoPhoto } from "@/lib/store/demo-photos";
import { FOLLOW_UP_UNAVAILABLE_MESSAGE, MAX_FOLLOW_UP_PHOTOS, caseRound, followUpAvailability } from "@/lib/rounds";
import { persistRuntimeFile } from "@/lib/storage/runtime-files";
import { getCase, saveCase } from "@/lib/store/cases";
import type { CaseRecord, Engine, FollowUp } from "@/lib/types";
import {
  IMAGE_EXTENSION,
  MAX_PHOTO_BYTES,
  sniffImageKind,
  validateFollowUp,
  type FieldErrors,
  type ImageKind,
} from "@/components/report-validation";
import { requireAccessCode } from "../../../_lib/access";
import { clientKey, rateLimit, realRunsPerDay, takeRealRun } from "../../../_lib/rate-limit";
import { errorResponse, failureResponse, isValidCaseId } from "../../../_lib/responses";
import { runtimeDir, toStoredPath } from "../../../_lib/runtime-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Same room as POST /api/reports: a real follow-up is a full run with the earlier photos and the new
// ones, and runAgent's own time budget (90 s) ends a slow one in a "needs a human" case before the
// platform kills the function.
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

// Each accepted follow-up can spend model credits like a report does: same cap per client (it even
// shares the bucket of POST /api/reports, so the two together cannot exceed it), and the same
// daily ceiling on real runs. Local development is not limited.
const RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };
const MAX_BODY_BYTES = MAX_FOLLOW_UP_PHOTOS * MAX_PHOTO_BYTES + 256 * 1024;

// A follow-up that is being run on this instance. A second one for the same case would run the
// agent twice on the same state and one of them would overwrite the other: refused (409). Per
// instance, like the rate limits; across instances the check after the run (updatedAt) catches it.
const running = new Set<string>();

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

/** The demo photo of the "simulate the customer's reply" button, hashed once: see isSimulatedReply. */
let demoReplyHash: string | null | undefined;
async function demoReplyPhotoHash(): Promise<string | null> {
  if (demoReplyHash !== undefined) return demoReplyHash;
  const file = resolveDemoPhoto(path.join("data", "photos", "lamp-sharp.jpg"));
  demoReplyHash = file ? createHash("sha256").update(await fs.readFile(/*turbopackIgnore: true*/ file)).digest("hex") : null;
  return demoReplyHash;
}

/**
 * True when one of the photos is, byte for byte, the demo photo of the "simulate the customer's
 * reply" button. The label "simulated" is worked out here from the bytes and never taken from the
 * request: a client cannot make a real reply look simulated, or the reverse.
 */
async function isSimulatedReply(buffers: { bytes: Buffer }[]): Promise<boolean> {
  const known = await demoReplyPhotoHash();
  if (!known) return false;
  return buffers.some(({ bytes }) => createHash("sha256").update(bytes).digest("hex") === known);
}

/**
 * POST /api/cases/[id]/follow-up: the customer replied to what the agent asked (sharper photos, a
 * corrected order number). multipart/form-data with `message`, 0 to 3 `photos` (at least one of the
 * two), an optional `orderNumber` (only when the case has no order yet) and an optional `round`
 * (the round the page showed: if the case moved on since, 409 instead of running twice). Stores the
 * new photos, runs the agent again on the SAME case with everything it knew (resumeAgent), saves
 * the case with a new round and answers `{ caseId, round, status, engine, decision }`.
 *
 * Same rules as POST /api/reports: the access code (401, 429 after too many wrong codes), the
 * rate limit, the daily ceiling of real runs (beyond it the round runs in labelled DEMO MODE) and
 * the shared storage for the photos. The engine is the one the case was run with: a private run
 * stays private (it never calls the Meta Model API), a mock stays a labelled mock. A recorded
 * showcase case is never modified: saving the new round stores a copy (copy-on-write), and the
 * committed recording stays round 1 of it. Nothing is ever sent to anyone.
 */
export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const { id } = await params;
  if (!isValidCaseId(id)) return errorResponse(404, "not_found", "Case not found.");

  const limited =
    process.env.NODE_ENV === "development"
      ? { ok: true, retryAfterSeconds: 0 }
      : rateLimit(clientKey(request), RATE_LIMIT);
  if (!limited.ok) {
    const res = errorResponse(429, "rate_limited", "Too many requests in a short time. Try again in a few minutes.");
    res.headers.set("Retry-After", String(limited.retryAfterSeconds));
    return res;
  }

  // Refused before the body is read, demo mode included: a follow-up can run a real model.
  const refused = requireAccessCode(
    request,
    "Adding the customer's reply on this public demo needs the access code from the submission.",
  );
  if (refused) return refused;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse(413, "too_large", `The upload is too large (max ${MAX_FOLLOW_UP_PHOTOS} photos of 8 MB each).`);
  }

  let current: CaseRecord | null;
  try {
    current = await getCase(id);
  } catch (err) {
    return failureResponse(err, "Loading the case");
  }
  if (!current) return errorResponse(404, "not_found", "Case not found.");
  const availability = followUpAvailability(current);
  if (!availability.available) {
    return errorResponse(409, `follow_up_${availability.reason}`, FOLLOW_UP_UNAVAILABLE_MESSAGE[availability.reason]);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "invalid_form", "Send the reply as multipart/form-data.");
  }

  const message = text(form, "message").trim();
  const files = form.getAll("photos").filter(isUploadedFile);
  const orderNumber = text(form, "orderNumber").trim();
  const seenRound = text(form, "round").trim();

  const errors: FieldErrors = validateFollowUp({ message, orderNumber }, files);
  // Only a case with no order yet takes a corrected number: on a case whose order was found, the
  // customer cannot point the agent at another order through a reply.
  if (orderNumber !== "" && current.order !== null && !errors.orderNumber) {
    errors.orderNumber = "This case already has its order: the number cannot be changed here.";
  }
  if (Object.keys(errors).length > 0) {
    return errorResponse(400, "validation", "The reply is not valid.", { fields: errors });
  }
  // The page says which round it showed. A case that moved on since (a double click, a second tab)
  // would otherwise run the agent again on a state the merchant never saw.
  if (seenRound !== "" && Number(seenRound) !== caseRound(current)) {
    return errorResponse(
      409,
      "stale_round",
      "This case has changed since you opened it (another reply was added). Reload the page to see the latest round.",
    );
  }

  // The MIME type is only what the client claims: read the real signature of each file.
  const buffers: { bytes: Buffer; kind: ImageKind }[] = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = sniffImageKind(bytes);
    if (!kind) {
      return errorResponse(400, "validation", "The reply is not valid.", {
        fields: { photos: `"${file.name}" is not a real JPEG, PNG or WebP image.` },
      });
    }
    buffers.push({ bytes, kind });
  }

  if (running.has(id)) {
    return errorResponse(409, "follow_up_running", "The agent is already working on a reply for this case. Wait for it to finish.");
  }
  running.add(id);
  try {
    // The engine of the case, never another: a private run stays private (open weights never reach
    // the Meta Model API, which is also why SAM and voice stay off), and a case made in DEMO MODE
    // stays in it. Without the credentials it resolves to the labelled mock, as a report does.
    const requested: Engine = current.engine;
    let engine = resolveEngine(requested);
    let fellBackReason: "no_credentials" | "daily_limit" | null = engine !== requested ? "no_credentials" : null;
    if (engine !== "demo-mock" && !takeRealRun(realRunsPerDay())) {
      engine = "demo-mock";
      fellBackReason = "daily_limit";
    }

    const followUpId = randomUUID();
    const simulated = await isSimulatedReply(buffers);
    let photoPaths: string[];
    try {
      const uploadDir = path.join(runtimeDir(), "uploads", followUpId);
      if (buffers.length > 0) await fs.mkdir(uploadDir, { recursive: true });
      photoPaths = await Promise.all(
        buffers.map(async ({ bytes, kind }, i) => {
          const target = path.join(uploadDir, `photo-${i + 1}.${IMAGE_EXTENSION[kind]}`);
          await fs.writeFile(target, bytes);
          // With a shared store the photo must outlive this instance. Without one this does nothing.
          await persistRuntimeFile(target);
          return toStoredPath(target);
        }),
      );
    } catch (err) {
      console.error("[gilmend] could not store the follow-up photos:", err instanceof Error ? err.message : err);
      return errorResponse(500, "storage_failed", "Could not store the photos on the server.");
    }

    const followUp: FollowUp = {
      id: followUpId,
      receivedAt: new Date().toISOString(),
      message,
      photos: photoPaths,
      ...(orderNumber !== "" ? { orderNumber } : {}),
      ...(simulated ? { simulated: true } : {}),
    };

    let result: CaseRecord;
    try {
      result = await resumeAgent(current, followUp, { engine });
    } catch (err) {
      // resumeAgent is meant never to throw. If it does the case is left exactly as it was (round 1
      // intact) and the merchant can try again.
      console.error("[gilmend] follow-up run failed:", err instanceof Error ? err.message : err);
      return errorResponse(502, "agent_failed", "The agent could not process this reply. The case was not changed.", {
        caseId: id,
      });
    }

    let saved: CaseRecord;
    try {
      // The run took a while: if the case was changed meanwhile (the merchant approved it in another
      // tab, another instance added a reply), writing the result would silently undo that.
      const latest = await getCase(id);
      if (!latest || latest.updatedAt !== current.updatedAt || caseRound(latest) !== caseRound(current)) {
        return errorResponse(
          409,
          "case_changed",
          "The case was changed while the agent was working. Nothing was overwritten: reload the page and add the reply again.",
        );
      }
      // A full save, not a patch: the result replaces the current round (the earlier one is in
      // previousRounds) and drops `recorded`. On a recorded showcase case this stores a copy and
      // the committed recording is untouched (layered store).
      saved = await saveCase(result);
    } catch (err) {
      console.error("[gilmend] could not save the follow-up:", err instanceof Error ? err.message : err);
      return errorResponse(500, "storage_failed", "The reply was processed but the case could not be saved.");
    }

    return Response.json(
      {
        caseId: saved.id,
        round: caseRound(saved),
        status: saved.status,
        engine: saved.engine,
        requestedEngine: requested,
        decision: saved.decision?.decision ?? null,
        needsHuman: saved.decision?.needsHuman ?? true,
        // True when the server could not run the engine the case was made with.
        fellBack: engine !== requested,
        fellBackReason: engine !== requested ? fellBackReason : null,
        simulated,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    running.delete(id);
  }
}
