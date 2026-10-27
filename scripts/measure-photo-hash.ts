// `npx tsx scripts/measure-photo-hash.ts`: re-measures the thresholds of src/lib/integrity/image-hash.ts.
// It hashes the six demo photos and 120 synthetic smooth pictures, re-saves 66 of them five ways, and
// prints (1) how many re-saves stay within the thresholds, (2) how many pairs of DIFFERENT pictures
// are wrongly matched, (3) the closest pair of different demo photos. Run it after touching the hash
// or the thresholds, and update the comment above DHASH_MAX_DISTANCE with the new figures.
// No network, no key, no file written.
import sharp from "sharp";
import { AHASH_MAX_DISTANCE, DHASH_MAX_DISTANCE, compareHashes, hashImage } from "../src/lib/integrity/image-hash";
import { DEMO_PHOTO_NAMES, demoPhotoBytes, syntheticPhoto } from "../src/lib/integrity/test-helpers";

async function resaves(b: Buffer): Promise<Buffer[]> {
  return [
    await sharp(b).resize({ width: 640 }).jpeg({ quality: 55 }).toBuffer(),
    await sharp(b).jpeg({ quality: 40 }).toBuffer(),
    await sharp(b).resize({ width: 300 }).png().toBuffer(),
    await sharp(b).modulate({ brightness: 1.12 }).jpeg().toBuffer(),
    await sharp(b).resize({ width: 640 }).jpeg({ quality: 30 }).toBuffer(),
  ];
}

async function main(): Promise<void> {
  const demo = DEMO_PHOTO_NAMES.map(demoPhotoBytes);
  const synthetic: Buffer[] = [];
  for (let i = 0; i < 120; i++) synthetic.push(await syntheticPhoto(100 + i));

  let copies = 0;
  let within = 0;
  for (const b of [...demo, ...synthetic.slice(0, 60)]) {
    const original = (await hashImage(b))!;
    for (const copy of await resaves(b)) {
      copies++;
      if (compareHashes(original, (await hashImage(copy))!).match) within++;
    }
  }

  const hashes = await Promise.all(synthetic.map(async (b) => (await hashImage(b))!));
  let pairs = 0;
  let falseMatches = 0;
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      pairs++;
      if (compareHashes(hashes[i], hashes[j]).match) falseMatches++;
    }
  }

  const demoHashes = await Promise.all(demo.map(async (b) => (await hashImage(b))!));
  let closestD = 64;
  let closestA = 64;
  for (let i = 0; i < demoHashes.length; i++) {
    for (let j = i + 1; j < demoHashes.length; j++) {
      const c = compareHashes(demoHashes[i], demoHashes[j]);
      closestD = Math.min(closestD, c.dhashDistance);
      closestA = Math.min(closestA, c.ahashDistance);
    }
  }

  console.log(`thresholds: dHash <= ${DHASH_MAX_DISTANCE}, aHash <= ${AHASH_MAX_DISTANCE} (out of 64 bits)`);
  console.log(`re-saves still matched: ${within}/${copies}`);
  console.log(`different synthetic pictures wrongly matched: ${falseMatches}/${pairs} pairs (${((100 * falseMatches) / pairs).toFixed(2)} %)`);
  console.log(`closest pair of different demo photos: dHash ${closestD}, aHash ${closestA}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
