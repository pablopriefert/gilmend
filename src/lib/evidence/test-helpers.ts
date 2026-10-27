import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
// Deep import on purpose (test only): the package does not export its encoder, and we need
// a REAL payload so the tests prove our wire handling against the vendor's own codec.
import { encodeSegmentationMask } from "../../../node_modules/@meta-sam/parser/dist/mask-codec.js";

export const IMAGE_W = 400;
export const IMAGE_H = 300;

export async function writeGreyPhoto(dir: string, name = "photo.jpg"): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(
    file,
    await sharp({ create: { width: IMAGE_W, height: IMAGE_H, channels: 3, background: "#888888" } })
      .jpeg()
      .toBuffer(),
  );
  return file;
}

/**
 * One SAM output line: an elliptical mask inside a 120 x 80 box, by default x 100..219,
 * y 80..159 (wire x2/y2 inclusive). `at` moves the box and `objectId` tells objects apart when
 * several lines are sent in one answer (one per region, as SAM streams them).
 */
export function samLine(confidence?: number, at: { x: number; y: number } = { x: 100, y: 80 }, objectId = 0): string {
  const w = 120;
  const h = 80;
  const raster = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2);
      const dy = (y - h / 2) / (h / 2);
      raster[y * w + x] = dx * dx + dy * dy <= 1 ? 1 : 0;
    }
  }
  const mask = encodeSegmentationMask(raster, w, h);
  const c = confidence === undefined ? "" : `;c=${confidence}`;
  // The vendor payload already starts with its encoding marker.
  return `<0f>${objectId}<|box;x1=${at.x};y1=${at.y};x2=${at.x + w - 1};y2=${at.y + h - 1};w=${IMAGE_W};h=${IMAGE_H}${c}|><|mask;x=0;y=0${c};data=${h},${w},${mask.payload}|>`;
}

const LANE = { item_id: "msg_1", output_index: 0, content_index: 0 };

/** A Responses-style SSE body, as the Model API streams it. */
export function sseBody(lines: string[], { withDone = true } = {}): string {
  const events: object[] = [{ type: "response.created", response: { id: "resp_1" } }];
  for (const line of lines) events.push({ type: "response.output_text.delta", delta: line, ...LANE });
  if (withDone) events.push({ type: "response.output_text.done", text: lines.join(""), ...LANE });
  events.push({ type: "response.completed", response: { id: "resp_1" } });
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
}

export function sseResponse(lines: string[], opts?: { withDone?: boolean }): Response {
  return new Response(sseBody(lines, opts), { headers: { "content-type": "text/event-stream" } });
}

/**
 * The lines of several regions in one SAM answer: one object id each, and the `<0f>` encoding
 * marker only on the first (a second marker makes the vendor parser report a malformed record).
 */
export function samRegions(regions: Array<{ confidence?: number; at: { x: number; y: number } }>): string[] {
  return regions.map((r, i) => {
    const line = samLine(r.confidence, r.at, i);
    return i === 0 ? line : line.replace("<0f>", "");
  });
}

/** A fetch that answers each SAM request according to the concept it asks for (none: no region). */
export function fakeSam(
  byConcept: Record<string, string[] | Response | Error>,
  asked: string[] = [],
): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const concept = JSON.parse(init?.body as string).input[0].content[0].text as string;
    asked.push(concept);
    const answer = byConcept[concept];
    if (answer instanceof Error) throw answer;
    if (answer instanceof Response) return answer;
    return sseResponse(answer ?? []);
  }) as unknown as typeof fetch;
}
