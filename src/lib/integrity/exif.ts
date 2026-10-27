// A tiny, defensive reader of the capture date in a photo's EXIF block. No dependency: sharp
// hands us the raw EXIF bytes (metadata().exif) and we read only one thing, DateTimeOriginal
// (when the shutter was pressed) with DateTimeDigitized as the fallback. The file is customer
// input, so every read is bounds-checked, nothing loops on an offset found in the file, and any
// surprise returns null instead of throwing.
//
// What is deliberately NOT read: IFD0 "DateTime" (tag 0x0132). It is the date the file was last
// modified by software, so an edited or re-saved photo carries a recent date and it says nothing
// about when the picture was taken.

const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;
const TYPE_ASCII = 2;
/** "YYYY:MM:DD HH:MM:SS" plus the terminating zero. */
const DATE_FIELD_BYTES = 20;
/** An EXIF directory has a handful of entries; this only bounds the work on a hostile file. */
const MAX_ENTRIES = 512;

export interface ExifCapture {
  /** "YYYY-MM-DDTHH:mm:ss" exactly as written in the file: EXIF stores local time, with no zone. */
  date: string;
  tag: "DateTimeOriginal" | "DateTimeDigitized";
}

/** "2026:10:12 14:03:09" to "2026-10-12T14:03:09", or null when it is not a plausible date. */
export function parseExifDateTime(raw: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  // "0000:00:00 00:00:00" is what several cameras write when the clock was never set.
  if (year < 1990 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  // Rejects 31 February: the calendar must give the same day back.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

interface Reader {
  u16(at: number): number | null;
  u32(at: number): number | null;
}

function readerFor(tiff: Uint8Array): Reader | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const reader: Reader = {
    u16: (at) => (at >= 0 && at + 2 <= tiff.length ? view.getUint16(at, little) : null),
    u32: (at) => (at >= 0 && at + 4 <= tiff.length ? view.getUint32(at, little) : null),
  };
  // The TIFF magic number, 42, in the file's own byte order.
  return reader.u16(2) === 42 ? reader : null;
}

/** The ASCII date entries (original and digitized) of the directory at `ifdOffset`, by tag. */
function readDateEntries(tiff: Uint8Array, r: Reader, ifdOffset: number): Map<number, string> {
  const found = new Map<number, string>();
  const count = r.u16(ifdOffset);
  if (count === null) return found;
  for (let i = 0; i < Math.min(count, MAX_ENTRIES); i++) {
    const entry = ifdOffset + 2 + i * 12;
    const tag = r.u16(entry);
    const type = r.u16(entry + 2);
    const n = r.u32(entry + 4);
    const valueOffset = r.u32(entry + 8);
    if (tag === null || type === null || n === null || valueOffset === null) break;
    if (tag !== TAG_DATE_TIME_ORIGINAL && tag !== TAG_DATE_TIME_DIGITIZED) continue;
    // A date is 20 bytes, so it never fits in the 4-byte value slot: it is stored at an offset.
    if (type !== TYPE_ASCII || n !== DATE_FIELD_BYTES) continue;
    if (valueOffset + DATE_FIELD_BYTES > tiff.length) continue;
    let text = "";
    for (let k = 0; k < DATE_FIELD_BYTES - 1; k++) text += String.fromCharCode(tiff[valueOffset + k]);
    found.set(tag, text);
  }
  return found;
}

/**
 * The capture date in an EXIF block, or null when there is none, it is not a valid date, or the
 * block is malformed. Accepts the block with or without the "Exif\0\0" prefix that JPEG puts in
 * front of the TIFF header.
 */
export function parseExifCaptureDate(exif: Uint8Array): ExifCapture | null {
  try {
    const hasPrefix =
      exif.length >= 6 && String.fromCharCode(...exif.subarray(0, 4)) === "Exif" && exif[4] === 0 && exif[5] === 0;
    const tiff = hasPrefix ? exif.subarray(6) : exif;
    const r = readerFor(tiff);
    if (!r) return null;
    const ifd0 = r.u32(4);
    if (ifd0 === null) return null;

    // Find the pointer to the Exif directory inside IFD0.
    let exifIfd: number | null = null;
    const count = r.u16(ifd0);
    if (count === null) return null;
    for (let i = 0; i < Math.min(count, MAX_ENTRIES); i++) {
      const entry = ifd0 + 2 + i * 12;
      if (r.u16(entry) === TAG_EXIF_IFD) {
        exifIfd = r.u32(entry + 8);
        break;
      }
    }
    if (exifIfd === null) return null;

    const dates = readDateEntries(tiff, r, exifIfd);
    for (const [tag, name] of [
      [TAG_DATE_TIME_ORIGINAL, "DateTimeOriginal"],
      [TAG_DATE_TIME_DIGITIZED, "DateTimeDigitized"],
    ] as const) {
      const raw = dates.get(tag);
      const date = raw === undefined ? null : parseExifDateTime(raw);
      if (date) return { date, tag: name };
    }
    return null;
  } catch {
    return null;
  }
}

export interface PhotoExif {
  /** True when the file carries an EXIF block at all (most apps strip it on upload). */
  present: boolean;
  capture: ExifCapture | null;
}

/** EXIF facts of an image file. Never throws: an unreadable file has no EXIF. */
export async function readPhotoExif(bytes: Uint8Array): Promise<PhotoExif> {
  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(bytes).metadata();
    if (!meta.exif || meta.exif.length === 0) return { present: false, capture: null };
    return { present: true, capture: parseExifCaptureDate(meta.exif) };
  } catch {
    return { present: false, capture: null };
  }
}
