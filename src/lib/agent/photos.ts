import { readFile } from "node:fs/promises";
import path from "node:path";
import { runtimeDir } from "../runtime-dir";
import { restoreRuntimeFile } from "../storage/runtime-files";

// Photos reach the model as image_url parts. A report stores either a data URL, an
// http(s) URL or a local file path; local files are inlined as data URLs so the same
// request works on every provider (an open-weights server cannot reach our disk).

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * The image type read from the first bytes of the file, never from its name. The demo
 * photos were WebP files named ".jpg": the old extension lookup sent them to the model as
 * "image/jpeg", which a strict API may refuse or decode wrongly.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  ) {
    return "image/webp";
  }
  if (b.length >= 6 && String.fromCharCode(b[0], b[1], b[2], b[3]) === "GIF8") return "image/gif";
  return null;
}

/**
 * Local photos are only read from data/ and public/ under the working directory, and from
 * the runtime folder (uploads: data/runtime locally, the OS temp dir on Vercel). A report's
 * photo path comes from an upload route; without this check a crafted path could make the
 * agent read any file on the server and send it to a model.
 */
function allowedRoots(cwd: string, runtime: string): string[] {
  return [path.resolve(cwd, "data"), path.resolve(cwd, "public"), path.resolve(runtime)];
}

export async function photoToImageUrl(
  photo: string,
  cwd: string = process.cwd(),
  runtime: string = runtimeDir(),
): Promise<string> {
  if (photo.startsWith("data:image/")) return photo;
  if (/^https?:\/\//i.test(photo)) return photo;
  const resolved = path.resolve(/*turbopackIgnore: true*/ cwd, photo);
  if (!allowedRoots(cwd, runtime).some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
    throw new Error("photo path is outside data/, public/ and the runtime folder");
  }
  // A photo uploaded on another serverless instance is not in this one's /tmp: fetch it back from the
  // shared store first, as image-io and the file route do. Without this a follow-up that arrives hours
  // later on another instance read nothing (ENOENT) and the model never saw the photos of round 1
  // (review of 28 Oct 2026). Only runtime files have a copy in the store; data/ and public/ are in the build.
  const runtimeRoot = path.resolve(runtime);
  if (resolved === runtimeRoot || resolved.startsWith(runtimeRoot + path.sep)) {
    await restoreRuntimeFile(resolved, runtimeRoot);
  }
  const bytes = await readFile(/*turbopackIgnore: true*/ resolved);
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error("photo is larger than 10 MB");
  const mime = sniffMime(bytes);
  if (!mime) throw new Error("unsupported photo type (expected jpeg, png, webp or gif)");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
