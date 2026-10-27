import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  AHASH_MAX_DISTANCE,
  DHASH_MAX_DISTANCE,
  compareHashes,
  hammingDistance,
  hashImage,
  isPhotoHash,
} from "./image-hash";
import { DEMO_PHOTO_NAMES, demoPhotoBytes, recompress, syntheticPhoto } from "./test-helpers";

describe("hashImage", () => {
  it("gives two 64-bit hashes as 16 hex characters, and the same ones every time", async () => {
    const bytes = demoPhotoBytes("vase-broken");
    const a = await hashImage(bytes);
    const b = await hashImage(bytes);
    expect(isPhotoHash(a)).toBe(true);
    expect(b).toEqual(a);
  });

  it.each(DEMO_PHOTO_NAMES)("%s still matches itself after a resize and a JPEG re-compression", async (name) => {
    const original = demoPhotoBytes(name);
    const copy = await recompress(original);
    expect(copy.length).toBeLessThan(original.length); // really another file
    const cmp = compareHashes((await hashImage(original))!, (await hashImage(copy))!);
    expect(cmp.match).toBe(true);
    expect(cmp.dhashDistance).toBeLessThanOrEqual(DHASH_MAX_DISTANCE);
    expect(cmp.ahashDistance).toBeLessThanOrEqual(AHASH_MAX_DISTANCE);
  });

  it("keeps ordinary smooth pictures apart from each other and matches each with its own re-save", async () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const originals = await Promise.all(seeds.map(async (s) => (await hashImage(await syntheticPhoto(s)))!));
    const copies = await Promise.all(seeds.map(async (s) => (await hashImage(await recompress(await syntheticPhoto(s))))!));
    for (let i = 0; i < seeds.length; i++) {
      for (let j = 0; j < seeds.length; j++) {
        expect(compareHashes(originals[i], copies[j]).match, `picture ${seeds[i]} vs re-save of ${seeds[j]}`).toBe(i === j);
      }
    }
  });

  it("matches the same picture saved as PNG, and with a small brightness change", async () => {
    const original = demoPhotoBytes("headphones-cracked");
    const hash = (await hashImage(original))!;
    const png = await sharp(original).resize({ width: 800 }).png().toBuffer();
    const brighter = await sharp(original).modulate({ brightness: 1.15 }).jpeg().toBuffer();
    expect(compareHashes(hash, (await hashImage(png))!).match).toBe(true);
    expect(compareHashes(hash, (await hashImage(brighter))!).match).toBe(true);
  });

  it("does not match any two different demo photos, with a wide margin", async () => {
    const hashes = await Promise.all(DEMO_PHOTO_NAMES.map(async (n) => (await hashImage(demoPhotoBytes(n)))!));
    let closestD = 64;
    let closestA = 64;
    for (let i = 0; i < hashes.length; i++) {
      for (let j = i + 1; j < hashes.length; j++) {
        const cmp = compareHashes(hashes[i], hashes[j]);
        expect(cmp.match, `${DEMO_PHOTO_NAMES[i]} vs ${DEMO_PHOTO_NAMES[j]}`).toBe(false);
        closestD = Math.min(closestD, cmp.dhashDistance);
        closestA = Math.min(closestA, cmp.ahashDistance);
      }
    }
    // The thresholds were chosen inside the gap measured on 27 Oct 2026 (the same picture moves by at most 8 and 7 bits, different pictures start at 25 and 20): keep room.
    expect(closestD).toBeGreaterThan(DHASH_MAX_DISTANCE + 8);
    expect(closestA).toBeGreaterThan(AHASH_MAX_DISTANCE + 4);
  });

  it("reads the EXIF orientation: a photo stored sideways with its tag is the same picture", async () => {
    const original = demoPhotoBytes("vase-broken");
    const sideways = await sharp(original).rotate(270).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const physicallyRotated = await sharp(original).rotate(270).jpeg().toBuffer();
    const hash = (await hashImage(original))!;
    expect(compareHashes(hash, (await hashImage(sideways))!).match).toBe(true);
    // Without the tag the same pixels are a different picture: documented, not hidden.
    expect(compareHashes(hash, (await hashImage(physicallyRotated))!).match).toBe(false);
  });

  it("does not catch a mirror image or a heavy crop (the limit the case page states)", async () => {
    const original = demoPhotoBytes("carton-crushed");
    const hash = (await hashImage(original))!;
    const mirrored = await sharp(original).flop().jpeg().toBuffer();
    const meta = await sharp(original).metadata();
    const cropped = await sharp(original)
      .extract({
        left: Math.round(meta.width! * 0.1),
        top: Math.round(meta.height! * 0.1),
        width: Math.round(meta.width! * 0.85),
        height: Math.round(meta.height! * 0.85),
      })
      .jpeg()
      .toBuffer();
    expect(compareHashes(hash, (await hashImage(mirrored))!).match).toBe(false);
    expect(compareHashes(hash, (await hashImage(cropped))!).match).toBe(false);
  });

  it("flattens transparency on white, so a PNG with an alpha channel hashes like its flattened copy", async () => {
    const base = sharp(demoPhotoBytes("lamp-blurry")).resize({ width: 300 });
    const opaque = await base.clone().png().toBuffer();
    const withAlpha = await base.clone().ensureAlpha(0.999).png().toBuffer();
    expect(compareHashes((await hashImage(opaque))!, (await hashImage(withAlpha))!).match).toBe(true);
  });

  it("returns null for bytes that are not an image, and never throws", async () => {
    expect(await hashImage(Buffer.from("not an image at all"))).toBeNull();
    expect(await hashImage(new Uint8Array(0))).toBeNull();
    expect(await hashImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toBeNull();
  });
});

describe("hammingDistance and isPhotoHash", () => {
  it("counts differing bits", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("000000000000000f", "0000000000000001")).toBe(3);
  });

  it("accepts only 16 lowercase hex characters twice (a case file is data read back from storage)", () => {
    expect(isPhotoHash({ dhash: "0123456789abcdef", ahash: "fedcba9876543210" })).toBe(true);
    expect(isPhotoHash({ dhash: "0123456789abcde", ahash: "fedcba9876543210" })).toBe(false);
    expect(isPhotoHash({ dhash: "0123456789ABCDEF", ahash: "fedcba9876543210" })).toBe(false);
    expect(isPhotoHash({ dhash: "0123456789abcdef" })).toBe(false);
    expect(isPhotoHash(null)).toBe(false);
    expect(isPhotoHash("0123456789abcdef")).toBe(false);
  });
});
