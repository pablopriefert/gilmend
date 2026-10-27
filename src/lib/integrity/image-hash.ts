// Perceptual hashes of a photo, to tell whether the same picture was filed twice.
//
// Two small hashes of 64 bits each, computed on a grayscale thumbnail after the EXIF orientation is
// applied:
//  - dHash (difference hash, 9x8 thumbnail): one bit per pair of horizontally neighbouring pixels,
//    "is the left one brighter?". It follows the gradients of the picture, so a resize, a
//    re-compression or a small brightness change leave it nearly unchanged.
//  - aHash (average hash, 8x8 thumbnail): one bit per pixel, "is it brighter than the mean?".
//    Coarser, and it fails in different ways from dHash.
// A pair of photos matches only when BOTH are close (compareHashes): two independent views of the
// picture have to agree before a customer's report is flagged.
//
// What this does NOT catch, and the case page says so: a photo that was cropped by more than a few
// percent, mirrored, rotated, or heavily edited, and a photo of a screen showing another photo.
// It is a cheap signal for the lazy re-use of a file, not forensic image matching.

import type { PhotoHash } from "../types";

export type { PhotoHash };

const HEX_64 = /^[0-9a-f]{16}$/;

/** True when `v` has the shape of a stored PhotoHash (a case file is data we read back). */
export function isPhotoHash(v: unknown): v is PhotoHash {
  if (typeof v !== "object" || v === null) return false;
  const h = v as { dhash?: unknown; ahash?: unknown };
  return typeof h.dhash === "string" && HEX_64.test(h.dhash) && typeof h.ahash === "string" && HEX_64.test(h.ahash);
}

/**
 * Largest dHash and aHash distances (out of 64 bits) at which two photos count as the same picture.
 * Measured on 27 Oct 2026 with scripts/measure-photo-hash.ts (re-run it after any change here):
 *  - the six demo photos and 60 synthetic smooth pictures, each re-saved five ways (resize and JPEG
 *    quality 55, JPEG 40, PNG at 300 px, +12 % brightness, JPEG 30 at 640 px): 329 of the 330 copies
 *    stayed within 10 and 10;
 *  - the six demo photos are at least 25 (dHash) and 20 (aHash) bits apart from each other;
 *  - 7,140 pairs of DIFFERENT synthetic smooth pictures (random blurred blobs, the hardest case
 *    for a hash: little detail to tell them apart) gave 9 false matches, 0.13 %. Photos of real
 *    scenes have more structure. A false match only asks a person to look; it never decides.
 * A bigger grid (12x12, 16x16) separated worse: it follows the resampling noise of a re-save.
 */
export const DHASH_MAX_DISTANCE = 10;
export const AHASH_MAX_DISTANCE = 10;

function bitsToHex(bits: boolean[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i] ? 8 : 0) + (bits[i + 1] ? 4 : 0) + (bits[i + 2] ? 2 : 0) + (bits[i + 3] ? 1 : 0)).toString(16);
  }
  return hex;
}

/**
 * The two hashes of an image, or null when sharp cannot decode the bytes (a corrupt file, a
 * format it does not read). Never throws: an unreadable photo is reported, not a crash.
 */
export async function hashImage(bytes: Uint8Array): Promise<PhotoHash | null> {
  try {
    // Loaded lazily, as in src/lib/evidence/image-io.ts: a missing native binary then degrades to
    // "could not hash" instead of breaking the whole module graph.
    const { default: sharp } = await import("sharp");
    // `fill` squeezes the whole picture into the grid whatever its aspect ratio, so two sizes of
    // the same picture land on the same cells. Flattened on white first: a PNG with transparency
    // must not hash differently from its flattened copy.
    const grid = (width: number, height: number) =>
      sharp(bytes)
        .rotate()
        .flatten({ background: "#ffffff" })
        .grayscale()
        .resize(width, height, { fit: "fill", kernel: "lanczos3" })
        .raw()
        .toBuffer();
    const [wide, square] = await Promise.all([grid(9, 8), grid(8, 8)]);
    if (wide.length < 72 || square.length < 64) return null;

    const dBits: boolean[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) dBits.push(wide[y * 9 + x] > wide[y * 9 + x + 1]);
    }
    let sum = 0;
    for (let i = 0; i < 64; i++) sum += square[i];
    const mean = sum / 64;
    const aBits: boolean[] = [];
    for (let i = 0; i < 64; i++) aBits.push(square[i] > mean);

    return { dhash: bitsToHex(dBits), ahash: bitsToHex(aBits) };
  } catch {
    return null;
  }
}

/** Number of differing bits between two 16-hex-digit hashes. */
export function hammingDistance(a: string, b: string): number {
  let bits = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16);
    while (x) {
      bits += x & 1;
      x >>= 1;
    }
  }
  return bits;
}

export interface HashComparison {
  match: boolean;
  dhashDistance: number;
  ahashDistance: number;
}

/** Whether two photos are the same picture (see the thresholds above), with the distances. */
export function compareHashes(a: PhotoHash, b: PhotoHash): HashComparison {
  const dhashDistance = hammingDistance(a.dhash, b.dhash);
  const ahashDistance = hammingDistance(a.ahash, b.ahash);
  return {
    match: dhashDistance <= DHASH_MAX_DISTANCE && ahashDistance <= AHASH_MAX_DISTANCE,
    dhashDistance,
    ahashDistance,
  };
}
