import type { Env } from "../config";
import { createBlobObjectStore } from "./blob-object-store";
import type { ObjectStore } from "./object-store";

// Which storage the app runs on, chosen by the environment:
//
//   DAMAGE_DESK_STORAGE unset or "file"  local files under the runtime folder (default: local
//                                        development, tests, `npm run demo`). On Vercel those
//                                        files live in /tmp and belong to one instance.
//   "blob"                               Vercel Blob, a PRIVATE store shared by every
//                                        instance (src/lib/storage/blob-object-store.ts,
//                                        docs/storage.md).
//   anything else                        an error.
//
// An unknown value is an error, not a silent fallback to files: someone who sets the variable
// expects cases to survive across instances, and quietly losing them would be worse.

let override: ObjectStore | null | undefined;
let blobStore: ObjectStore | undefined;

/** Tests: force the shared store (null = none). `undefined` goes back to the environment. */
export function overrideSharedObjects(store: ObjectStore | null | undefined): void {
  override = store;
}

/** The shared object store, or null when the app runs on local files. */
export function sharedObjects(env: Env = process.env): ObjectStore | null {
  if (override !== undefined) return override;
  const kind = env.DAMAGE_DESK_STORAGE?.trim().toLowerCase() ?? "";
  switch (kind) {
    case "":
    case "file":
      return null;
    case "blob":
      return (blobStore ??= createBlobObjectStore());
    default:
      throw new Error(
        `Unknown DAMAGE_DESK_STORAGE "${kind.slice(0, 40)}". Use "file" (default) or "blob" (see docs/storage.md).`,
      );
  }
}

/**
 * True when a new case will only exist on the serverless instance that created it: on Vercel
 * (VERCEL is set) with no shared store. Another instance then answers 404 for that case.
 */
export function storageIsEphemeral(env: Env = process.env): boolean {
  return Boolean(env.VERCEL) && sharedObjects(env) === null;
}
