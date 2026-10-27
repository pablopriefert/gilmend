import { createHash, timingSafeEqual } from "node:crypto";
import type { Env } from "@/lib/config";
import { clientKey, isRateLimited, recordHit } from "./rate-limit";
import { errorResponse } from "./responses";

// The public demo URL has no user accounts. Three things are worth protecting there: the model
// credits (every real run spends some), the cases (anyone could approve, reject or rewrite a
// reply while the judges look) and the public wall itself (the list shows every case, so
// whatever a stranger files is shown to the judges). A shared demo code, read from the
// environment and compared on the server, covers all three without building an auth system:
//  - POST /api/reports and POST /api/transcribe: without the code the request is refused (401),
//    demo mode included. An earlier version still let an anonymous visitor file a report in
//    labelled demo mode (final review of 27 Oct 2026): anyone could put text and photos of their
//    choice on a page the judges are looking at, so a public deployment takes NO new report
//    without the code. The six
//    recorded runs stay visible to everyone;
//  - PATCH /api/cases/[id]: without the code the change is refused (401);
//  - GET /api/cases/[id]/pdf: an existing PDF is served to anyone (the case page embeds it in an
//    iframe, which cannot send a header); building a new one needs the code.
// Unset DAMAGE_DESK_ACCESS_CODE (local development) and nothing is checked.
// Never type real customer data on a public URL: GET /api/cases lists every case.
//
// Brute force: a code that is typed by hand can be guessed by a loop, so the failed attempts of a
// client are counted and, past ACCESS_FAILURES, even the right code is refused (429) until the
// window has slid. A request WITHOUT any code is not an attempt and is not counted. The count is
// per instance, in memory and keyed by the first hop of x-forwarded-for, like the other limits
// here: on Vercel the platform sets that header, behind a proxy that does not overwrite it a client can
// spoof it.
// The real protection is a long random code (16 characters or more, see .env.example).

export const ACCESS_CODE_HEADER = "x-access-code";

export function accessCodeRequired(env: Env = process.env): boolean {
  return Boolean(env.DAMAGE_DESK_ACCESS_CODE?.trim());
}

/** True when no code is configured, or when the request carries the right one. */
export function hasValidAccessCode(request: Request, env: Env = process.env): boolean {
  const expected = env.DAMAGE_DESK_ACCESS_CODE?.trim();
  if (!expected) return true;
  const given = request.headers.get(ACCESS_CODE_HEADER)?.trim() ?? "";
  // Compare digests so the comparison takes the same time whatever the length or content.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Failed access-code attempts allowed per client before the code is refused for a while. */
export const ACCESS_FAILURES = { limit: 10, windowMs: 10 * 60_000 };

/**
 * The gate of every route that needs the access code. Returns null when the request may go on
 * (no code configured, or the right one), else the response to send:
 *  - 401 `access_code_required` when the code is missing or wrong (`whenMissing` says what to do);
 *  - 429 `too_many_attempts` with Retry-After when this client has failed too often.
 * Call it before reading the body: a refused request costs nothing.
 */
export function requireAccessCode(
  request: Request,
  whenMissing: string,
  env: Env = process.env,
  now: number = Date.now(),
): Response | null {
  if (!accessCodeRequired(env)) return null;
  const tried = Boolean(request.headers.get(ACCESS_CODE_HEADER)?.trim());
  const key = `access-failures:${clientKey(request)}`;
  // Checked before the comparison, so a locked-out client cannot use the answer to keep guessing.
  if (tried) {
    const lock = isRateLimited(key, { ...ACCESS_FAILURES, now });
    if (lock.limited) {
      const res = errorResponse(
        429,
        "too_many_attempts",
        "Too many wrong access codes. Wait a few minutes before trying again.",
      );
      res.headers.set("Retry-After", String(lock.retryAfterSeconds));
      return res;
    }
  }
  if (hasValidAccessCode(request, env)) return null;
  if (!tried) return errorResponse(401, "access_code_required", whenMissing);
  recordHit(key, { windowMs: ACCESS_FAILURES.windowMs, now });
  return errorResponse(401, "access_code_required", "That access code is not correct. " + whenMissing);
}
