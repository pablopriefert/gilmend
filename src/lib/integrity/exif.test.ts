import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";
import { parseExifCaptureDate, parseExifDateTime, readPhotoExif } from "./exif";
import { buildExif, demoPhotoBytes, syntheticPhoto } from "./test-helpers";

const ORIGINAL = 0x9003;
const DIGITIZED = 0x9004;
const DATE = "2026:10:12 14:03:09";

describe("parseExifCaptureDate on a hand-built block", () => {
  it.each([
    ["little endian, with the JPEG prefix", { little: true, prefix: true }],
    ["little endian, bare TIFF", { little: true, prefix: false }],
    ["big endian, with the JPEG prefix", { little: false, prefix: true }],
    ["big endian, bare TIFF", { little: false, prefix: false }],
  ])("reads DateTimeOriginal (%s)", (_name, options) => {
    const exif = buildExif([{ tag: ORIGINAL, value: DATE }], options);
    expect(parseExifCaptureDate(exif)).toEqual({ date: "2026-10-12T14:03:09", tag: "DateTimeOriginal" });
  });

  it("falls back to DateTimeDigitized when there is no original date", () => {
    const exif = buildExif([{ tag: DIGITIZED, value: "2026:10:13 08:00:00" }]);
    expect(parseExifCaptureDate(exif)).toEqual({ date: "2026-10-13T08:00:00", tag: "DateTimeDigitized" });
  });

  it("prefers DateTimeOriginal over DateTimeDigitized", () => {
    const exif = buildExif([
      { tag: DIGITIZED, value: "2026:10:13 08:00:00" },
      { tag: ORIGINAL, value: DATE },
    ]);
    expect(parseExifCaptureDate(exif)?.date).toBe("2026-10-12T14:03:09");
  });

  it("does not take IFD0 DateTime (0x0132) for a capture date: it is the last-edited date", () => {
    const exif = buildExif([], { ifd0Tag: { tag: 0x0132, value: DATE } });
    expect(parseExifCaptureDate(exif)).toBeNull();
  });

  it("returns null for a date that is not a date", () => {
    for (const value of ["0000:00:00 00:00:00", "2026:02:31 10:00:00", "2026:13:01 10:00:00", "2026:10:12 25:00:00", "not a date at all!!", "2026-10-12 14:03:09"]) {
      expect(parseExifCaptureDate(buildExif([{ tag: ORIGINAL, value }])), value).toBeNull();
    }
  });

  it("returns null, without throwing, on garbage, truncation and hostile offsets", () => {
    const good = buildExif([{ tag: ORIGINAL, value: DATE }], { prefix: true });
    expect(parseExifCaptureDate(new Uint8Array(0))).toBeNull();
    expect(parseExifCaptureDate(Buffer.from("this is not exif"))).toBeNull();
    expect(parseExifCaptureDate(Buffer.alloc(64, 0xff))).toBeNull();
    // Every possible truncation of a valid block: a customer's file may be cut anywhere.
    for (let n = 0; n < good.length; n++) {
      expect(() => parseExifCaptureDate(good.subarray(0, n)), `cut at ${n}`).not.toThrow();
    }
    expect(parseExifCaptureDate(good.subarray(0, good.length - 5))).toBeNull(); // date bytes cut off

    // IFD0 offset pointing far outside the block.
    const outside = Buffer.from(good);
    outside.writeUInt32LE(0x7fffffff, 6 + 4);
    expect(parseExifCaptureDate(outside)).toBeNull();

    // An entry count of 65535 must be bounded, not walked off the end.
    const huge = Buffer.from(good);
    huge.writeUInt16LE(0xffff, 6 + 8);
    expect(() => parseExifCaptureDate(huge)).not.toThrow();
  });

  it("returns null when the magic number is not 42", () => {
    const exif = buildExif([{ tag: ORIGINAL, value: DATE }]);
    exif.writeUInt16LE(43, 2);
    expect(parseExifCaptureDate(exif)).toBeNull();
  });
});

describe("parseExifDateTime", () => {
  it("converts the EXIF layout to ISO without a zone", () => {
    expect(parseExifDateTime("2026:10:12 14:03:09")).toBe("2026-10-12T14:03:09");
    expect(parseExifDateTime(" 2026:01:01 00:00:00 ")).toBe("2026-01-01T00:00:00");
  });
  it("rejects what is not a plausible capture", () => {
    expect(parseExifDateTime("1970:01:01 00:00:00")).toBeNull();
    expect(parseExifDateTime("2026:04:31 10:00:00")).toBeNull(); // April has 30 days
    expect(parseExifDateTime("")).toBeNull();
  });
});

describe("readPhotoExif on real image files", () => {
  it.each([
    ["jpeg", (s: Sharp) => s.jpeg()],
    ["png", (s: Sharp) => s.png()],
    ["webp", (s: Sharp) => s.webp()],
  ])("reads the capture date a %s was written with", async (_name, encode) => {
    const base = await syntheticPhoto(1);
    const bytes = await encode(sharp(base).withExif({ IFD2: { DateTimeOriginal: DATE } } as never)).toBuffer();
    expect(await readPhotoExif(bytes)).toEqual({
      present: true,
      capture: { date: "2026-10-12T14:03:09", tag: "DateTimeOriginal" },
    });
  });

  it("says there is no EXIF at all for a photo without a block (the normal case after an upload)", async () => {
    expect(await readPhotoExif(await syntheticPhoto(2))).toEqual({ present: false, capture: null });
    // The demo photos are AI-generated: XMP only, no EXIF.
    expect(await readPhotoExif(demoPhotoBytes("vase-broken"))).toEqual({ present: false, capture: null });
  });

  it("tells an EXIF block without a capture date from no block", async () => {
    const bytes = await sharp(await syntheticPhoto(3))
      .withExif({ IFD0: { Copyright: "nobody" } } as never)
      .jpeg()
      .toBuffer();
    expect(await readPhotoExif(bytes)).toEqual({ present: true, capture: null });
  });

  it("never throws on bytes that are not an image", async () => {
    expect(await readPhotoExif(Buffer.from("nope"))).toEqual({ present: false, capture: null });
  });
});
