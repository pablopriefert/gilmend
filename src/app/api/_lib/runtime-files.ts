import { promises as fs } from "node:fs";
import path from "node:path";
import { runtimeDir } from "@/lib/runtime-dir";
import { resolveShowcaseFile } from "@/lib/showcase/showcase";
import { sharedObjects } from "@/lib/storage";
import { restoreRuntimeFile } from "@/lib/storage/runtime-files";

// The API routes only ever read or write inside the runtime folder (see src/lib/runtime-dir.ts:
// data/runtime locally, the OS temp dir on Vercel, DAMAGE_DESK_RUNTIME_DIR for tests).
export { runtimeDir, toStoredPath } from "@/lib/runtime-dir";

/**
 * Resolve a stored or requested path to a real file inside the runtime folder, or null.
 * Accepts a path relative to the runtime folder ("uploads/x/photo-1.jpg"), to the project
 * root ("data/runtime/uploads/...") or absolute. `realpath` makes a symlink or a ".." trick
 * unable to point outside; a missing file also gives null.
 *
 * Two more places are served, and nothing else: the committed read-only showcase
 * ("data/showcase/...", see src/lib/showcase), and, when a shared object store is configured,
 * a runtime file that another serverless instance wrote (it is downloaded into the runtime
 * folder first, see src/lib/storage/runtime-files.ts).
 */
export async function resolveRuntimeFile(requested: string): Promise<string | null> {
  if (requested === "" || requested.includes("\0")) return null;
  const recorded = await resolveShowcaseFile(requested);
  if (recorded) return recorded;
  // The folder is chosen at run time on purpose: tell the bundler not to trace the project for it.
  const lexicalRoot = path.resolve(/*turbopackIgnore: true*/ runtimeDir());
  let root: string;
  try {
    root = await fs.realpath(/*turbopackIgnore: true*/ lexicalRoot);
  } catch {
    // A fresh serverless instance has no runtime folder yet. With a shared store the file may
    // still exist there, so make the folder; without one there is nothing to serve.
    if (!sharedObjects()) return null;
    try {
      await fs.mkdir(/*turbopackIgnore: true*/ lexicalRoot, { recursive: true });
      root = await fs.realpath(/*turbopackIgnore: true*/ lexicalRoot);
    } catch {
      return null;
    }
  }
  const candidates = path.isAbsolute(requested)
    ? [requested]
    : [
        path.resolve(/*turbopackIgnore: true*/ lexicalRoot, requested),
        path.resolve(/*turbopackIgnore: true*/ process.cwd(), requested),
      ];
  for (const candidate of candidates) {
    try {
      // Only a path lexically inside the runtime folder can be restored from the shared
      // store; the realpath check below still decides whether what is on disk may be served.
      await restoreRuntimeFile(candidate, lexicalRoot);
      const real = await fs.realpath(candidate);
      if (real.startsWith(root + path.sep) && (await fs.stat(real)).isFile()) return real;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
