import { promises as fs } from "node:fs";
import path from "node:path";
import { runtimeDir } from "@/lib/runtime-dir";

// The API routes only ever read or write inside the runtime folder (see src/lib/runtime-dir.ts:
// data/runtime locally, the OS temp dir on Vercel, DAMAGE_DESK_RUNTIME_DIR for tests).
export { runtimeDir, toStoredPath } from "@/lib/runtime-dir";

/**
 * Resolve a stored or requested path to a real file inside the runtime folder, or null.
 * Accepts a path relative to the runtime folder ("uploads/x/photo-1.jpg"), to the project
 * root ("data/runtime/uploads/...") or absolute. `realpath` makes a symlink or a ".." trick
 * unable to point outside; a missing file also gives null.
 */
export async function resolveRuntimeFile(requested: string): Promise<string | null> {
  if (requested === "" || requested.includes("\0")) return null;
  let root: string;
  try {
    // The folder is chosen at run time on purpose: tell the bundler not to trace the project for it.
    root = await fs.realpath(/*turbopackIgnore: true*/ runtimeDir());
  } catch {
    return null;
  }
  const candidates = path.isAbsolute(requested)
    ? [requested]
    : [
        path.resolve(/*turbopackIgnore: true*/ root, requested),
        path.resolve(/*turbopackIgnore: true*/ process.cwd(), requested),
      ];
  for (const candidate of candidates) {
    try {
      const real = await fs.realpath(candidate);
      if (real.startsWith(root + path.sep) && (await fs.stat(real)).isFile()) return real;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
