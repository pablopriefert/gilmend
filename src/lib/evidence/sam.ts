import {
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type SegmentationBoxRecord,
  type SegmentationMaskRecord,
} from "@meta-sam/parser";
import { assertStandardModel, META_API_BASE_URL, type Env } from "../config";

// SAM 3.1 on the Meta Model API. Shape checked against dev.meta.ai/docs/sam/* on 2026-10-27:
//  - POST {base}/responses (Responses API, same Bearer key as Muse Spark), model "sam-3.1";
//  - one user message: an input_text noun phrase naming ONE concept + one input_image
//    (public URL or base64 data URL);
//  - the answer streams back as special-token text in response.output_text.delta events;
//  - metadata values are strings, "true" not true.
// Not exercised against the live service yet: the key did not exist when this was written.

export const SAM_MODEL = "sam-3.1";

export interface SamRequestBody {
  model: string;
  input: Array<{
    type: "message";
    role: "user";
    content: Array<
      { type: "input_text"; text: string } | { type: "input_image"; image_url: string }
    >;
  }>;
  stream: true;
  metadata: { mask_encoding: "one_bit"; include_confidence: "true" };
}

/** Build the request body. `concept` must be a short noun phrase ("crack", not a sentence). */
export function buildSamRequest(imageDataUrl: string, concept: string): SamRequestBody {
  return {
    model: assertStandardModel(SAM_MODEL),
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: concept },
          { type: "input_image", image_url: imageDataUrl },
        ],
      },
    ],
    stream: true,
    // one_bit = smallest mask payloads; include_confidence adds a 0..1 score per record.
    metadata: { mask_encoding: "one_bit", include_confidence: "true" },
  };
}

export function samEndpoint(env: Env = process.env): string {
  const base = (env.SAM_BASE_URL || env.MODEL_BASE_URL || META_API_BASE_URL).replace(/\/+$/, "");
  return `${base}/responses`;
}

export interface SamDetection {
  objectId: string;
  /** Pixels in the sent image; right and bottom are exclusive edges (parser convention). */
  box: { left: number; top: number; right: number; bottom: number };
  /** Binary raster of the mask, row-major, covering exactly the box area. */
  mask: { raster: Uint8Array; width: number; height: number } | null;
  confidence: number | null;
}

export interface SamOptions {
  env?: Env;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface SseEvent {
  type: string;
  [key: string]: unknown;
}

// Lane ids the parser expects on output_text events. Real events carry them; the fallback
// path below has to invent them.
const LANE = { item_id: "msg_0", output_index: 0, content_index: 0 };

async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      // SSE events are separated by a blank line; tolerate \r\n.
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = done ? "" : (blocks.pop() ?? "");
      for (const block of done ? blocks.concat(buffer) : blocks) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        try {
          yield JSON.parse(data) as SseEvent;
        } catch {
          // A keep-alive or a non-JSON line: not segmentation output.
        }
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Pull the text out of a non-streamed Responses API body (defensive: shape not verified). */
function textOfResponseBody(json: unknown): string {
  const root = json as { output_text?: unknown; output?: unknown };
  if (typeof root?.output_text === "string") return root.output_text;
  const parts: string[] = [];
  if (Array.isArray(root?.output)) {
    for (const item of root.output as Array<{ content?: Array<{ text?: unknown }> }>) {
      for (const part of item?.content ?? []) if (typeof part?.text === "string") parts.push(part.text);
    }
  }
  return parts.join("");
}

/**
 * The parser wants every output_text lane closed by a `response.output_text.done` before
 * `response.completed`. A real Responses stream sends it; if a server (or the JSON fallback
 * below) skips it, close the lane ourselves so a good answer is not thrown away.
 */
async function* closeLanes(source: AsyncIterable<SseEvent>): AsyncGenerator<SseEvent> {
  const open = new Map<string, { lane: typeof LANE; text: string }>();
  for await (const event of source) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      const lane = {
        item_id: String(event.item_id ?? LANE.item_id),
        output_index: Number(event.output_index ?? LANE.output_index),
        content_index: Number(event.content_index ?? LANE.content_index),
      };
      const key = `${lane.item_id}:${lane.output_index}:${lane.content_index}`;
      const entry = open.get(key) ?? { lane, text: "" };
      entry.text += event.delta;
      open.set(key, entry);
    } else if (event.type === "response.output_text.done") {
      open.delete(`${String(event.item_id)}:${Number(event.output_index)}:${Number(event.content_index)}`);
    } else if (event.type === "response.completed") {
      for (const { lane, text } of open.values()) {
        yield { type: "response.output_text.done", text, ...lane };
      }
      open.clear();
    }
    yield event;
  }
}

async function* eventsOf(response: Response): AsyncGenerator<SseEvent> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("event-stream") && contentType.includes("json")) {
    // The server answered with a single JSON body despite stream:true.
    const text = textOfResponseBody(await response.json());
    if (text) yield { type: "response.output_text.delta", delta: text, ...LANE };
    yield { type: "response.completed" };
    return;
  }
  if (!response.body) throw new Error("SAM answered without a body");
  yield* readSse(response.body);
}

function pair(
  boxes: readonly SegmentationBoxRecord[],
  masks: readonly SegmentationMaskRecord[],
): SamDetection[] {
  const detections: SamDetection[] = [];
  for (const box of boxes) {
    const mask = masks.find(
      (m) => m.objectId === box.objectId && (m.frame?.frameIndex ?? 0) === (box.frame?.frameIndex ?? 0),
    );
    let decoded: SamDetection["mask"] = null;
    if (mask) {
      try {
        decoded = {
          raster: decodeMaskToRaster(mask.mask),
          width: mask.mask.width,
          height: mask.mask.height,
        };
      } catch {
        // A bad mask payload still leaves a usable box.
        decoded = null;
      }
    }
    detections.push({
      objectId: box.objectId,
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      mask: decoded,
      confidence: box.confidence ?? mask?.confidence ?? null,
    });
  }
  return detections;
}

/**
 * Ask SAM 3.1 for every region of the image matching `concept`. Throws on transport or
 * protocol errors (the caller turns them into method 'none'); returns [] when nothing
 * matches, which the docs describe as a normal outcome, not an error.
 */
export async function segmentConcept(
  imageDataUrl: string,
  concept: string,
  options: SamOptions = {},
): Promise<SamDetection[]> {
  const env = options.env ?? process.env;
  const key = env.MODEL_API_KEY?.trim();
  if (!key) throw new Error("MODEL_API_KEY is not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(samEndpoint(env), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(buildSamRequest(imageDataUrl, concept)),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Truncate: an error body can echo parts of the request. The key is never in it.
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`SAM request failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const parsed = parseImageStream(closeLanes(eventsOf(response)));
    const result = await parsed.finalResult;
    if (result.outcome.status !== "completed") {
      throw new Error("SAM stream ended before completion");
    }
    const failed = result.diagnostics.find((d) => d.severity === "error");
    if (failed && result.records.length === 0) throw new Error(`SAM output not readable (${failed.code})`);

    return pair(recordsOfKind(result.records, "box"), recordsOfKind(result.records, "mask"));
  } finally {
    clearTimeout(timer);
  }
}
