import { describe, expect, it } from "vitest";
import { paintDetections } from "./annotate";

describe("paintDetections", () => {
  const alphaAt = (layer: Uint8Array, width: number, x: number, y: number) => layer[(y * width + x) * 4 + 3]!;

  it("paints a box frame with no mask, leaving the inside transparent", () => {
    const layer = paintDetections(
      [{ objectId: "0", box: { left: 10, top: 10, right: 30, bottom: 30 }, mask: null, confidence: null }],
      50,
      50,
    );
    expect(alphaAt(layer, 50, 10, 10)).toBe(255);
    expect(alphaAt(layer, 50, 29, 29)).toBe(255);
    expect(alphaAt(layer, 50, 20, 20)).toBe(0);
    expect(alphaAt(layer, 50, 5, 5)).toBe(0);
  });

  it("clips a box that sticks out of the image instead of throwing", () => {
    const layer = paintDetections(
      [{ objectId: "0", box: { left: -5, top: -5, right: 12, bottom: 12 }, mask: null, confidence: null }],
      10,
      10,
    );
    expect(layer.length).toBe(10 * 10 * 4);
  });

  it("scales a mask whose raster is a pixel off the box", () => {
    const raster = new Uint8Array(4 * 4).fill(1);
    const layer = paintDetections(
      [{ objectId: "0", box: { left: 2, top: 2, right: 11, bottom: 11 }, mask: { raster, width: 4, height: 4 }, confidence: 0.9 }],
      20,
      20,
    );
    expect(alphaAt(layer, 20, 6, 6)).toBe(90); // interior of the mask: translucent fill
  });
});
