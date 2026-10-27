import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runtimeDir } from "../runtime-dir";
import { sharedObjects } from "./index";
import { isSafeObjectKey } from "./object-store";

// The files the app generates at run time (uploaded photos, annotated evidence, claim PDFs)
// live in the runtime folder (src/lib/runtime-dir.ts). Local disk stays the working copy: SAM,
// sharp and pdf-lib read and write real files. When a shared object store is configured, each
// file is also copied to it after it is written (persistRuntimeFile) and copied back on demand
// when it is missing locally (restoreRuntimeFile), which is what happens when another
// serverless instance serves a case the first one created. With no shared store both are
// no-ops, so local development and the tests behave exactly as before.
//
// Keys are "files/<path under the runtime folder>", e.g. "files/evidence/ab12-annotated.jpg".

const FILES_PREFIX = "files/";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

/**
 * The object key of a file inside the runtime folder, or null when the path is outside it,
 * is the folder itself, or would make an unsafe key. Purely lexical: the file need not exist.
 */
export function runtimeObjectKey(file: string, root: string = runtimeDir()): string | null {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const key = `${FILES_PREFIX}${relative.split(path.sep).join("/")}`;
  return isSafeObjectKey(key) ? key : null;
}

/** Copy a runtime file to the shared store. No-op without one. Throws if the copy fails. */
export async function persistRuntimeFile(file: string, root: string = runtimeDir()): Promise<void> {
  const objects = sharedObjects();
  if (!objects) return;
  const key = runtimeObjectKey(file, root);
  if (!key) throw new Error(`Not a runtime file: ${path.basename(file)}`);
  const bytes = await fs.readFile(/*turbopackIgnore: true*/ path.resolve(file));
  const contentType = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  await objects.put(key, bytes, { contentType });
}

/**
 * Make sure a runtime file exists locally: when it is missing and the shared store holds it,
 * download it into place (temp file then rename, so a reader never sees half of it).
 * Returns true when the file is there afterwards. No-op (false when missing) without a store.
 */
export async function restoreRuntimeFile(file: string, root: string = runtimeDir()): Promise<boolean> {
  const target = path.resolve(file);
  try {
    if ((await fs.stat(/*turbopackIgnore: true*/ target)).isFile()) return true;
  } catch {
    // missing: try the shared store
  }
  const objects = sharedObjects();
  if (!objects) return false;
  const key = runtimeObjectKey(target, root);
  if (!key) return false;
  const found = await objects.get(key);
  if (!found) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, found.bytes);
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return true;
}
