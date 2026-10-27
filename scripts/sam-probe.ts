// One-off probe: which SAM 3.1 concept prompts find something on a demo photo. Spends a few
// cents (SAM is $2.50 per 1,000 images). Usage: npm run sam-probe -- <photo> <concept>...
import { readFileSync } from "node:fs";
import { segmentConcept } from "../src/lib/evidence/sam";

async function main(): Promise<void> {
  const [photo, ...concepts] = process.argv.slice(2);
  const ext = photo.endsWith(".webp") ? "webp" : photo.endsWith(".png") ? "png" : "jpeg";
  const dataUrl = `data:image/${ext};base64,${readFileSync(photo).toString("base64")}`;
  for (const concept of concepts) {
    try {
      const regions = await segmentConcept(dataUrl, concept, { env: process.env });
      console.log(`${concept.padEnd(22)} -> ${regions.length} region(s)${regions.length ? " " + JSON.stringify(regions.slice(0, 2).map((r) => ({ score: r.confidence, box: r.box }))) : ""}`);
    } catch (err) {
      console.log(`${concept.padEnd(22)} -> error: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
    }
  }
}
main();
