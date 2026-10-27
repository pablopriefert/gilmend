import { createHash, timingSafeEqual } from "node:crypto";
import type { Env } from "@/lib/config";

// The public demo URL has no user accounts. Two things are still worth protecting there:
// the model credits (every real run spends some) and the cases (anyone could approve, reject
// or rewrite a reply while the judges look). A shared demo code, read from the environment
// and compared on the server, covers both without building an auth system:
//  - POST /api/reports: without the code a request for a real engine runs in DEMO MODE
//    instead (labelled), so the public can still try the whole product for free;
//  - PATCH /api/cases/[id]: without the code the change is refused (401).
// Unset DAMAGE_DESK_ACCESS_CODE (local development) and nothing is checked.
// Never type real customer data on a public URL: GET /api/cases lists every case.

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
