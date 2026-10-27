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

/** One SAM output line: an elliptical mask inside the box x 100..219, y 80..159 (wire x2/y2 inclusive). */
export function samLine(confidence?: number): string {
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
  return `<0f>0<|box;x1=100;y1=80;x2=219;y2=159;w=${IMAGE_W};h=${IMAGE_H}${c}|><|mask;x=0;y=0${c};data=${h},${w},${mask.payload}|>`;
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
