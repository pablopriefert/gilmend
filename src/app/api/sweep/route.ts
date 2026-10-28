import { runSweepOnce } from "@/lib/sweep/run";
import { loadLatestSweep } from "@/lib/sweep/store";
import { requireAccessCode } from "../_lib/access";
import { clientKey, rateLimit } from "../_lib/rate-limit";
import { errorResponse, failureResponse } from "../_lib/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A sweep is at most six short model calls made at the same time (one briefing, up to five nudges),
// each cut at 25 s; this leaves room for reading the cases and storing the result.
export const maxDuration = 60;

// A sweep can spend model credits (at most six short calls, no image), so a public client gets a
// modest cap of its own, on top of the daily ceiling on real runs that runSweep takes a slot from.
// Local development is not limited, like POST /api/reports.
const RATE_LIMIT = { limit: 6, windowMs: 10 * 60_000 };

const NOCACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/sweep: the latest stored sweep, or `{ sweep: null }` when none has run yet. Public like
 * GET /api/cases: it holds order numbers, item titles, carriers, deadlines and drafts, and no
 * customer name, e-mail, address or message.
 */
export async function GET(): Promise<Response> {
  try {
    return Response.json({ sweep: await loadLatestSweep() }, { headers: NOCACHE });
  } catch (err) {
    return failureResponse(err, "Reading the sweep");
  }
}

/**
 * POST /api/sweep: run the morning sweep now. Optional JSON body `{ "includeRecorded": true }` also
 * reads the six recorded runs, each as of its recording day (a rehearsal: off by default).
 * Answers `{ sweep, stored }`. Nothing is sent to anyone: the nudges are drafts.
 *
 * When DAMAGE_DESK_ACCESS_CODE is set (a public deployment) the `x-access-code` header must carry
 * it (401, and 429 after too many wrong codes), because a sweep can call a real model. Rate limited
 * per client; a sweep that needs a model takes one slot of the daily ceiling on real runs, and past
 * it the texts are written by the labelled DEMO MODE script instead.
 */
export async function POST(request: Request): Promise<Response> {
  const limited =
    process.env.NODE_ENV === "development"
      ? { ok: true, retryAfterSeconds: 0 }
      : rateLimit(`sweep:${clientKey(request)}`, RATE_LIMIT);
  if (!limited.ok) {
    const res = errorResponse(429, "rate_limited", "Too many sweeps in a short time. Try again in a few minutes.");
    res.headers.set("Retry-After", String(limited.retryAfterSeconds));
    return res;
  }

  // Refused before the body is read: a refused request costs nothing.
  const refused = requireAccessCode(request, "Running the sweep on this public demo needs the access code from the submission.");
  if (refused) return refused;

  let includeRecorded = false;
  const raw = await request.text().catch(() => "");
  if (raw.trim() !== "") {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return errorResponse(400, "invalid_json", "Send a JSON body, or none.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return errorResponse(400, "invalid_body", "The body must be a JSON object.");
    }
    const flag = (body as { includeRecorded?: unknown }).includeRecorded;
    if (flag !== undefined && typeof flag !== "boolean") {
      return errorResponse(400, "invalid_body", "`includeRecorded` must be true or false.");
    }
    includeRecorded = flag === true;
  }

  try {
    const { sweep, stored } = await runSweepOnce({ trigger: "manual", includeRecorded });
    return Response.json({ sweep, stored }, { headers: NOCACHE });
  } catch (err) {
    return failureResponse(err, "The sweep");
  }
}
