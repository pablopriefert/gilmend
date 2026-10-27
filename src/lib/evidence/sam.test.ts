import { describe, expect, it } from "vitest";
import { buildSamRequest, samEndpoint, segmentConcept } from "./sam";
import { samLine, sseResponse } from "./test-helpers";

describe("buildSamRequest", () => {
  it("builds the documented Responses API body for sam-3.1", () => {
    expect(buildSamRequest("data:image/jpeg;base64,AAAA", "crack")).toEqual({
      model: "sam-3.1",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "crack" },
            { type: "input_image", image_url: "data:image/jpeg;base64,AAAA" },
          ],
        },
      ],
      stream: true,
      metadata: { mask_encoding: "one_bit", include_confidence: "true" },
    });
  });
});

describe("samEndpoint", () => {
  it("defaults to the Meta Model API", () => {
    expect(samEndpoint({})).toBe("https://api.meta.ai/v1/responses");
  });
});

describe("segmentConcept", () => {
  const env = { MODEL_API_KEY: "test-key-not-real" };

  it("returns boxes with a decoded mask raster covering the box", async () => {
    const fetchImpl = (async () => sseResponse([samLine(0.88)])) as unknown as typeof fetch;
    const [detection] = await segmentConcept("data:image/jpeg;base64,AAAA", "crack", { env, fetchImpl });
    // wire x2/y2 are inclusive: the parser reports exclusive right/bottom edges
    expect(detection!.box).toEqual({ left: 100, top: 80, right: 220, bottom: 160 });
    expect(detection!.confidence).toBe(0.88);
    expect(detection!.mask).not.toBeNull();
    expect([detection!.mask!.width, detection!.mask!.height]).toEqual([120, 80]);
    expect(detection!.mask!.raster.length).toBe(120 * 80);
    // centre of the ellipse is set, a corner is not
    expect(detection!.mask!.raster[40 * 120 + 60]).toBe(1);
    expect(detection!.mask!.raster[0]).toBe(0);
  });

  it("returns [] when nothing matches (a normal outcome, not an error)", async () => {
    const fetchImpl = (async () => sseResponse([])) as unknown as typeof fetch;
    await expect(segmentConcept("data:,", "crack", { env, fetchImpl })).resolves.toEqual([]);
  });

  it("refuses to call without a key", async () => {
    await expect(segmentConcept("data:,", "crack", { env: {} })).rejects.toThrow(/MODEL_API_KEY/);
  });
});
