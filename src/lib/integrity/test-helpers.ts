// Photos and EXIF blocks for the integrity tests. Imported only by tests.
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const DEMO_PHOTO_NAMES = [
  "vase-broken",
  "carton-crushed",
  "lamp-blurry",
  "parcel-open-missing",
  "headphones-cracked",
  "carafe-cracked",
] as const;

/** A demo photo file as shipped (data/photos, WebP). */
export function demoPhotoBytes(name: (typeof DEMO_PHOTO_NAMES)[number]): Buffer {
  return readFileSync(path.join(process.cwd(), "data", "photos", `${name}.webp`));
}

/** The same picture, as a messenger or a phone would send it again. */
export const recompress = (bytes: Buffer): Promise<Buffer> =>
  sharp(bytes).resize({ width: 640 }).jpeg({ quality: 55 }).toBuffer();

/** Small deterministic generator, so a test photo is the same bytes on every run. */
function seeded(seed: number): () => number {
  let state = (seed * 2654435761) % 4294967296;
  return () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

/**
 * A photo that is not a demo photo and looks like no other: soft coloured blobs with a little
 * noise, a stand-in for a smooth scene (a periodic pattern would alias when resized, which no
 * photo of a real scene does). `exifDate` writes a DateTimeOriginal ("2026:10:12 14:03:09").
 */
export async function syntheticPhoto(seed: number, exifDate?: string): Promise<Buffer> {
  const rand = seeded(seed + 1);
  const w = 160;
  const h = 120;
  const blobs = Array.from({ length: 14 }, () => ({
    x: rand() * w,
    y: rand() * h,
    s: 8 + rand() * 30,
    c: [rand() * 255, rand() * 255, rand() * 255],
  }));
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const acc = [60, 60, 60];
      for (const b of blobs) {
        const k = Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.s * b.s));
        for (let c = 0; c < 3; c++) acc[c] += (b.c[c] - 60) * k * 0.8;
      }
      for (let c = 0; c < 3; c++) raw[o + c] = Math.max(0, Math.min(255, acc[c] + (rand() - 0.5) * 12));
    }
  }
  const image = sharp(raw, { raw: { width: w, height: h, channels: 3 } }).resize(1200, 900, { kernel: "cubic" });
  const out = exifDate ? image.withExif({ IFD2: { DateTimeOriginal: exifDate } } as never) : image;
  return out.jpeg({ quality: 92 }).toBuffer();
}

/** A photo of one flat colour: black, white or a lens cap, whatever it was meant to show. */
export const flatPhoto = (r: number, g: number, b: number, width = 800, height = 600): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();

/** Blurred, near-black noise (values 0 to 11 of 255): a dark shot taken in a drawer. */
export async function noisyDarkPhoto(seed: number): Promise<Buffer> {
  const rand = seeded(seed + 1000);
  const w = 200;
  const h = 150;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(rand() * 12);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).blur(3).resize(800, 600).jpeg().toBuffer();
}

/**
 * A raw EXIF block built by hand: IFD0 with one pointer to an Exif directory holding the given
 * ASCII date tags. `little` picks the byte order, `prefix` adds the JPEG "Exif\0\0" header.
 */
export function buildExif(
  dates: { tag: number; value: string }[],
  options: { little?: boolean; prefix?: boolean; ifd0Tag?: { tag: number; value: string } } = {},
): Buffer {
  const little = options.little ?? true;
  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    if (little) b.writeUInt16LE(n);
    else b.writeUInt16BE(n);
    return b;
  };
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    if (little) b.writeUInt32LE(n);
    else b.writeUInt32BE(n);
    return b;
  };
  const entry = (tag: number, type: number, count: number, value: number) =>
    Buffer.concat([u16(tag), u16(type), u32(count), u32(value)]);

  const ifd0Entries = options.ifd0Tag ? 2 : 1;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const ifd0Offset = 8;
  const exifIfdOffset = ifd0Offset + ifd0Size;
  const exifIfdSize = 2 + dates.length * 12 + 4;
  let dataOffset = exifIfdOffset + exifIfdSize;

  const dataBlocks: Buffer[] = [];
  const ifd0Parts: Buffer[] = [u16(ifd0Entries)];
  if (options.ifd0Tag) {
    ifd0Parts.push(entry(options.ifd0Tag.tag, 2, 20, dataOffset));
    dataBlocks.push(Buffer.from(`${options.ifd0Tag.value}\0`, "ascii"));
    dataOffset += 20;
  }
  ifd0Parts.push(entry(0x8769, 4, 1, exifIfdOffset), u32(0));

  const exifParts: Buffer[] = [u16(dates.length)];
  for (const d of dates) {
    exifParts.push(entry(d.tag, 2, 20, dataOffset));
    dataBlocks.push(Buffer.from(`${d.value}\0`, "ascii"));
    dataOffset += 20;
  }
  exifParts.push(u32(0));

  const header = Buffer.concat([Buffer.from(little ? "II" : "MM", "ascii"), u16(42), u32(ifd0Offset)]);
  const tiff = Buffer.concat([header, ...ifd0Parts, ...exifParts, ...dataBlocks]);
  return options.prefix ? Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]) : tiff;
}
