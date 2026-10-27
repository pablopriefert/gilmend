import { describe, expect, it } from "vitest";
import { boxIou, isStrong, mergeRegions } from "./regions";
import type { SamDetection } from "./sam";

const region = (left: number, top: number, right: number, bottom: number, confidence: number | null): SamDetection => ({
  objectId: `${left}-${top}`,
  box: { left, top, right, bottom },
  mask: null,
  confidence,
});

describe("boxIou", () => {
  it("is 1 for the same box, 0 for disjoint or touching boxes", () => {
    expect(boxIou({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 0, top: 0, right: 10, bottom: 10 })).toBe(1);
    expect(boxIou({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 20, top: 0, right: 30, bottom: 10 })).toBe(0);
    // Right and bottom are exclusive: boxes that share an edge do not overlap.
    expect(boxIou({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(0);
  });

  it("is intersection over union", () => {
    // 10x10 and 10x10 shifted by 5 in x: intersection 50, union 150.
    expect(boxIou({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 0, right: 15, bottom: 10 })).toBeCloseTo(1 / 3);
  });

  it("is 0 for an empty box instead of dividing by zero", () => {
    expect(boxIou({ left: 5, top: 5, right: 5, bottom: 5 }, { left: 5, top: 5, right: 5, bottom: 5 })).toBe(0);
  });
});

describe("mergeRegions", () => {
  it("keeps the most confident regions first and counts what each concept brought", () => {
    const merged = mergeRegions(
      [
        { concept: "vase", regions: [region(0, 0, 100, 100, 0.6)] },
        { concept: "broken pottery", regions: [region(200, 0, 260, 60, 0.9), region(300, 0, 360, 60, 0.8)] },
      ],
      5,
    );
    expect(merged.regions.map((r) => r.confidence)).toEqual([0.9, 0.8, 0.6]);
    expect(merged.byConcept).toEqual([
      { concept: "vase", count: 1 },
      { concept: "broken pottery", count: 2 },
    ]);
  });

  it("drops a box that overlaps a kept one by more than 0.5, but keeps a smaller overlap", () => {
    const merged = mergeRegions(
      [
        { concept: "a", regions: [region(0, 0, 100, 100, 0.9)] },
        {
          concept: "b",
          regions: [
            region(5, 5, 100, 100, 0.95), // IoU 0.9025 with the 0.9 box, but more confident: it wins
            region(80, 0, 180, 100, 0.7), // overlap 20x100 of 2 boxes of 100x100: IoU 0.11, kept
          ],
        },
      ],
      5,
    );
    expect(merged.regions.map((r) => r.confidence)).toEqual([0.95, 0.7]);
    expect(merged.byConcept).toEqual([
      { concept: "b", count: 2 },
    ]);
  });

  it("caps the result and drops the concept whose regions were all cut", () => {
    const many = Array.from({ length: 6 }, (_, i) => region(i * 20, 0, i * 20 + 10, 10, 0.9 - i * 0.01));
    const merged = mergeRegions(
      [
        { concept: "weak", regions: [region(500, 500, 520, 520, 0.4)] },
        { concept: "shards", regions: many },
      ],
      5,
    );
    expect(merged.regions).toHaveLength(5);
    expect(merged.byConcept).toEqual([{ concept: "shards", count: 5 }]);
  });

  it("breaks a tie in favour of the concept asked first, and ranks a missing confidence as certain", () => {
    const tie = mergeRegions(
      [
        { concept: "first", regions: [region(0, 0, 10, 10, 0.8)] },
        { concept: "second", regions: [region(0, 0, 10, 10, 0.8)] },
      ],
      5,
    );
    expect(tie.byConcept).toEqual([{ concept: "first", count: 1 }]);
    const unscored = mergeRegions([{ concept: "x", regions: [region(0, 0, 10, 10, 0.9), region(50, 50, 60, 60, null)] }], 5);
    expect(unscored.regions[0].confidence).toBeNull();
  });

  it("returns nothing for nothing", () => {
    expect(mergeRegions([], 5)).toEqual({ regions: [], byConcept: [] });
  });
});

describe("isStrong", () => {
  it("needs at least two regions, not mostly marginal", () => {
    expect(isStrong([])).toBe(false);
    expect(isStrong([region(0, 0, 1, 1, 0.99)])).toBe(false);
    expect(isStrong([region(0, 0, 1, 1, 0.9), region(2, 2, 3, 3, 0.8)])).toBe(true);
    expect(isStrong([region(0, 0, 1, 1, 0.35), region(2, 2, 3, 3, 0.4)])).toBe(false);
    expect(isStrong([region(0, 0, 1, 1, null), region(2, 2, 3, 3, null)])).toBe(true);
  });
});
