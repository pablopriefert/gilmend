import os from "node:os";
import path from "node:path";
import type { Env } from "./config";

// ONE place decides where the app writes at run time (case files, uploaded photos, claim
// PDFs, annotated evidence). Before 27 Oct 2026 three modules each had their own rule and
// only the case store knew that Vercel's project folder is read-only: on a public deploy
// the upload route died with EROFS while the cases went to /tmp. Every writer and every
// reader now goes through runtimeDir(), so they cannot disagree again.

/**
 * Root folder of everything generated at run time.
 *  1. `override` (tests pass a temp folder);
 *  2. DAMAGE_DESK_RUNTIME_DIR (custom deployments, tests);
 *  3. on Vercel (VERCEL is set) the OS temp dir: /var/task is read-only there. Files then
 *     live as long as the serverless instance, and another instance does not see them: fine
 *     for a demo, not for production (see README, "Deploying");
 *  4. <cwd>/data/runtime (git-ignored).
 */
export function runtimeDir(override?: string, env: Env = process.env): string {
  if (override) return override;
  if (env.DAMAGE_DESK_RUNTIME_DIR) return env.DAMAGE_DESK_RUNTIME_DIR;
  if (env.VERCEL) return path.join(os.tmpdir(), "damage-desk");
  return path.join(process.cwd(), "data", "runtime");
}

/**
 * Path stored in cases and shown in the UI: relative to the project root when the file is
 * inside it (stable across machines), absolute otherwise (temp dir on Vercel or in tests).
 */
export function toStoredPath(absolutePath: string): string {
  const relative = path.relative(process.cwd(), absolutePath);
  return relative.startsWith("..") || path.isAbsolute(relative) ? absolutePath : relative;
}

/** Keeps an id usable as a file name and blocks path traversal ("../x" becomes ".._x"). */
export function safeFileStem(id: string): string {
  const stem = id.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+$/, "case");
  return stem.slice(0, 80) || "case";
}
