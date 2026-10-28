import { createHash, timingSafeEqual } from "node:crypto";
import { runSweepOnce } from "@/lib/sweep/run";
import { clientKey, isRateLimited, recordHit } from "../../_lib/rate-limit";
import { errorResponse, failureResponse } from "../../_lib/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Failed attempts at the secret, per client: a secret typed into a loop is a secret guessed.
const FAILURES = { limit: 10, windowMs: 10 * 60_000 };

function secretMatches(given: string, expected: string): boolean {
  // Digests of equal length: the comparison takes the same time whatever was sent.
  return timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(expected).digest());
}

/**
 * GET /api/sweep/cron: the daily sweep, called by Vercel Cron (vercel.json, 06:00 UTC, which is
 * 07:00 in Paris in winter and 08:00 in summer). Vercel sends `Authorization: Bearer <CRON_SECRET>`
 * when the project has a CRON_SECRET environment variable.
 *
 * Without CRON_SECRET the route REFUSES (503): an open endpoint that can call a model must not
 * exist by accident, and the access code is deliberately not accepted here (a person uses POST
 * /api/sweep). With a wrong or missing bearer: 401, and 429 after too many wrong ones from one
 * client. A cron sweep never reads the recorded runs, writes with the real engine when one is
 * configured (one slot of the daily ceiling on real runs, like a click) and stores its result as
 * the latest sweep. The answer is a short summary with no case data.
 */
export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return errorResponse(
      503,
      "cron_not_configured",
      "CRON_SECRET is not set, so the cron route refuses every call. Set it in the project's environment variables (Vercel sends it as a bearer token).",
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const given = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const key = `cron-failures:${clientKey(request)}`;
  if (given !== "") {
    const lock = isRateLimited(key, FAILURES);
    if (lock.limited) {
      const res = errorResponse(429, "too_many_attempts", "Too many wrong cron secrets. Wait a few minutes.");
      res.headers.set("Retry-After", String(lock.retryAfterSeconds));
      return res;
    }
  }
  if (given === "" || !secretMatches(given, expected)) {
    if (given !== "") recordHit(key, { windowMs: FAILURES.windowMs });
    return errorResponse(401, "unauthorized", "This route is for the scheduled cron job.");
  }

  try {
    const { sweep, stored } = await runSweepOnce({ trigger: "cron", includeRecorded: false });
    return Response.json(
      {
        ok: true,
        stored,
        generatedAt: sweep.generatedAt,
        engine: sweep.engine,
        fellBackReason: sweep.fellBackReason,
        counts: sweep.counts,
        modelCalls: sweep.modelCalls,
        reusedTexts: sweep.reusedTexts,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return failureResponse(err, "The scheduled sweep");
  }
}
