// Tiny in-memory sliding-window limiter for the one expensive route (POST /api/reports: each
// call can spend model credits). The demo URL is public, so a loop must not drain them.
// It is per server instance and resets on restart: enough for a hackathon demo, not for a
// real multi-instance deployment (that would need a shared store).

const hits = new Map<string, number[]>();

export function rateLimit(
  key: string,
  { limit, windowMs, now = Date.now() }: { limit: number; windowMs: number; now?: number },
): { ok: boolean; retryAfterSeconds: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  // Keep the map from growing without bound.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Whether `key` already used up `limit` hits in the window, WITHOUT counting this call: the
 * caller records a hit (recordHit) only for what it wants to count. Used for the failed
 * access-code attempts, where a successful request must not use up the allowance.
 */
export function isRateLimited(
  key: string,
  { limit, windowMs, now = Date.now() }: { limit: number; windowMs: number; now?: number },
): { limited: boolean; retryAfterSeconds: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length < limit) return { limited: false, retryAfterSeconds: 0 };
  return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
}

/** Count one hit for `key` (see isRateLimited). */
export function recordHit(key: string, { windowMs, now = Date.now() }: { windowMs: number; now?: number }): void {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  }
}

export function resetRateLimits(): void {
  hits.clear();
  daily.day = "";
  daily.count = 0;
}

// Global ceiling on REAL model runs per UTC day, on top of the per-client limit above: a
// person rotating IPs gets past a per-IP limit, and each real run can cost up to 8 turns with
// 3 images sent back every turn. Beyond it the route runs the labelled demo mode instead of
// failing. Per instance and in memory, like everything here: a ceiling, not an accounting.
const daily = { day: "", count: 0 };

export const DEFAULT_REAL_RUNS_PER_DAY = 100;

export function realRunsPerDay(env: Record<string, string | undefined> = process.env): number {
  // A blank value (the line copied from .env.example) means "default", not "zero runs".
  const raw = env.DAMAGE_DESK_REAL_RUNS_PER_DAY?.trim();
  if (!raw) return DEFAULT_REAL_RUNS_PER_DAY;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_REAL_RUNS_PER_DAY;
}

/** Reserve one real run for today; false when the daily ceiling is reached. */
export function takeRealRun(limit: number, now: number = Date.now()): boolean {
  const day = new Date(now).toISOString().slice(0, 10);
  if (daily.day !== day) {
    daily.day = day;
    daily.count = 0;
  }
  if (daily.count >= limit) return false;
  daily.count += 1;
  return true;
}

/**
 * Best-effort client key: first hop of x-forwarded-for, else a shared bucket. Vercel only: the
 * platform writes that header. Elsewhere a client can forge it and get a fresh bucket every time.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}
