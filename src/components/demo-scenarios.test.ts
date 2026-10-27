import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDemoPhoto } from "@/lib/store/demo-photos";
import { DEMO_SCENARIOS } from "./demo-scenarios";

const casesFile = path.join(process.cwd(), "data", "demo-cases.json");

describe("demo scenarios", () => {
  it("each one has a fallback illustration that is really in public/demo", () => {
    for (const s of DEMO_SCENARIOS) {
      for (const p of s.photos) {
        expect(existsSync(path.join(process.cwd(), "public", p.fallback)), p.fallback).toBe(true);
      }
    }
  });

  it("points to the demo photo route, which serves data/photos (public/demo never held them)", () => {
    for (const s of DEMO_SCENARIOS) {
      for (const p of s.photos) expect(p.src, s.id).toMatch(/^\/api\/demo-photo\?name=[a-z-]+$/);
    }
    // Every named photo is one the route serves and that exists on disk, as the team's .jpg
    // or as the provisional stand-in.
    const names = DEMO_SCENARIOS.flatMap((s) => s.photos.map((p) => new URL(p.src, "http://x").searchParams.get("name")!));
    expect(new Set(names).size).toBe(6);
    for (const name of names) {
      expect(resolveDemoPhoto(`data/photos/${name}.jpg`), name).not.toBeNull();
    }
  });

  it("ids are unique", () => {
    expect(new Set(DEMO_SCENARIOS.map((s) => s.id)).size).toBe(DEMO_SCENARIOS.length);
  });

  // The buttons must hand the agent the same case data/demo-cases.json describes, otherwise
  // the "expected outcome" written there stops meaning anything.
  it.skipIf(!existsSync(casesFile))("match the cases in data/demo-cases.json", () => {
    const { cases } = JSON.parse(readFileSync(casesFile, "utf8")) as {
      cases: { orderNumber: string; customerEmail: string; message: string; language: string }[];
    };
    expect(DEMO_SCENARIOS).toHaveLength(cases.length);
    cases.forEach((c, i) => {
      expect(DEMO_SCENARIOS[i].orderNumber).toBe(c.orderNumber);
      expect(DEMO_SCENARIOS[i].email).toBe(c.customerEmail);
      expect(DEMO_SCENARIOS[i].message).toBe(c.message);
      expect(DEMO_SCENARIOS[i].language).toBe(c.language);
    });
  });
});
