// Generates one demo photo with Meta's Muse Image (muse-image-1.0, Meta Model API).
// The six stand-ins in data/photos/ were made this way on 27 Oct 2026: fictitious parcels,
// no real customer, no real label. Usage (the key is read from .env.local, never printed):
//   node --env-file=.env.local scripts/generate-demo-photo.mjs data/photos/vase-broken.webp "<prompt>"
// Example prompt (the vase of case 1): "Realistic smartphone photo taken by a customer at home,
// daylight, kitchen table. An opened brown kraft shipping box, outside looks fine, with crumpled
// paper padding inside. Inside the box a white ceramic vase lies broken into several clean
// pieces. A small hand-written paper label taped in the box corner reads 6A99001001001.
// Slightly imperfect framing, natural phone photo, no people, no logos, no printed shipping label."
import { writeFileSync } from "node:fs";

const [, , output, prompt] = process.argv;
const key = process.env.MODEL_API_KEY?.trim();
if (!output || !prompt) {
  console.error('Usage: node --env-file=.env.local scripts/generate-demo-photo.mjs <output.webp> "<prompt>"');
  process.exit(1);
}
if (!key) {
  console.error("MODEL_API_KEY is missing: nothing was sent.");
  process.exit(1);
}

const base = (process.env.MODEL_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/+$/, "");
const response = await fetch(`${base}/images/generations`, {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "muse-image-1.0", prompt, n: 1 }),
});
if (!response.ok) {
  // Status only: the body may echo the request.
  console.error(`Muse Image answered HTTP ${response.status}.`);
  process.exit(1);
}
const item = (await response.json()).data?.[0];
// The API answers with base64 (WebP); a URL is handled too in case that changes.
const bytes = item?.b64_json
  ? Buffer.from(item.b64_json, "base64")
  : item?.url
    ? Buffer.from(await (await fetch(item.url)).arrayBuffer())
    : null;
if (!bytes) {
  console.error("Muse Image returned no image.");
  process.exit(1);
}
writeFileSync(output, bytes);
console.log(`Wrote ${output} (${bytes.length} bytes, muse-image-1.0).`);
