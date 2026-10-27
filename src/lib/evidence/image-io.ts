import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { restoreRuntimeFile } from "../storage/runtime-files";

// Photos reach us as a file path or a data URL (see DamageReport.photos). This module is
// the single place that turns such a reference into bytes, so the SAM call and the PDF
// builder apply the same safety rules.

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

export interface LoadedImage {
  bytes: Buffer;
  /** Where the bytes came from, for logs and notes. Never a data URL (too long). */
  origin: string;
}

export interface LoadImageOptions {
  /** Extra folders a photo may live in, on top of the project root and the OS temp dir. */
  allowedRoots?: string[];
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve a photo reference to bytes.
 *  - data URLs are decoded;
 *  - http(s) URLs are refused on purpose: fetching an arbitrary URL from the server is an
 *    SSRF risk and photos are uploaded to us, never linked;
 *  - paths must stay inside the project, the OS temp dir or an explicitly allowed root, so a
 *    crafted report cannot make us read or embed "/etc/passwd".
 * A leading "/" is also tried under public/ (the Next.js convention for "/uploads/x.jpg").
 */
export async function loadImage(ref: string, options: LoadImageOptions = {}): Promise<LoadedImage> {
  if (ref.startsWith("data:")) {
    const match = /^data:([^,]*),([\s\S]*)$/.exec(ref);
    if (!match) throw new Error("malformed data URL");
    const isBase64 = /;base64$/i.test(match[1] ?? "");
    const payload = match[2] ?? "";
    const bytes = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
    if (bytes.length === 0) throw new Error("empty data URL");
    if (bytes.length > MAX_PHOTO_BYTES) throw new Error("photo too large (over 20 MB)");
    return { bytes, origin: "data URL" };
  }
  if (/^https?:\/\//i.test(ref)) {
    throw new Error("remote photo URLs are not fetched (upload the file instead)");
  }

  const roots = [process.cwd(), os.tmpdir(), ...(options.allowedRoots ?? [])].map((r) => path.resolve(r));
  const candidates = [path.resolve(ref)];
  if (ref.startsWith("/")) candidates.push(path.resolve(process.cwd(), "public", `.${ref}`));
  else candidates.push(path.resolve(process.cwd(), "public", ref));

  for (const candidate of candidates) {
    if (!roots.some((root) => isInside(root, candidate))) continue;
    try {
      // A photo another serverless instance stored (shared store configured) is downloaded
      // into the runtime folder first; without a shared store this is a plain stat.
      await restoreRuntimeFile(candidate);
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      if (info.size > MAX_PHOTO_BYTES) throw new Error("photo too large (over 20 MB)");
      return { bytes: await readFile(candidate), origin: path.basename(candidate) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error(`photo not found or outside the allowed folders: ${path.basename(ref)}`);
}

export interface NormalisedImage {
  /** JPEG bytes, EXIF rotation applied, long side capped. */
  jpeg: Buffer;
  width: number;
  height: number;
}

/**
 * Decode any common photo format, apply the EXIF rotation (SAM and the PDF must agree on
 * which way is up, and SAM's coordinates are in "displayed" pixels), cap the long side and
 * re-encode as JPEG. sharp is loaded lazily so a missing native binary degrades to a
 * handled error instead of breaking the whole module graph.
 */
export async function normaliseImage(bytes: Buffer, maxLongSide: number): Promise<NormalisedImage> {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(bytes, { failOn: "error" })
    .rotate()
    .resize({ width: maxLongSide, height: maxLongSide, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height };
}
