import { describe, expect, it } from "vitest";
import { IMPACT_SOURCES } from "./sources";

describe("impact sources", () => {
  it("cites a real address, a publication date and a reading date for every source", () => {
    expect(IMPACT_SOURCES.length).toBeGreaterThan(0);
    for (const s of IMPACT_SOURCES) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.publishedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.checkedOn >= s.publishedOn).toBe(true);
      expect(s.figures.length).toBeGreaterThan(0);
    }
  });

  it("says what each figure is not, and never offers one as a per-parcel damage rate", () => {
    for (const s of IMPACT_SOURCES) {
      expect(s.caveat.length).toBeGreaterThan(30);
    }
    const studies = IMPACT_SOURCES.map((s) => s.caveat).join(" ");
    expect(studies).toMatch(/no per-parcel damage rate/);
  });

  it("has unique ids", () => {
    expect(new Set(IMPACT_SOURCES.map((s) => s.id)).size).toBe(IMPACT_SOURCES.length);
  });
});
