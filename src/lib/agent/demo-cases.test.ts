import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadDemoCases } from "../store/demo-cases";
import { runAgent } from "./run-agent";

// Cross-lot check: the six filmable cases of the spec (data/demo-cases.json) run through the
// real loop with the demo-mock engine and the real orders, rules and PDF modules. Only
// mark_damage is faked, so this test can never reach the Meta API whatever the shell holds.

beforeAll(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("the six demo cases, demo-mock engine, real modules", () => {
  for (const demo of loadDemoCases()) {
    it(`${demo.id}: ${demo.title}`, async () => {
      const c = await runAgent(demo.report, {
        engine: "demo-mock",
        env: {},
        deps: {
          markDamage: async (photo) => ({ photo, annotatedPhoto: null, method: "none", note: "faked in test" }),
        },
      });
      expect(c.engine).toBe("demo-mock");
      expect(c.status).toBe("needs_review");
      expect(demo.expected.acceptableDecisions).toContain(c.decision?.decision);
      expect(c.decision?.carrierClaim).toBe(demo.expected.carrierClaim);
      expect(c.decision?.needsHuman).toBe(demo.expected.needsHuman);
      expect(c.document !== null).toBe(demo.expected.carrierClaim);
    });
  }
});
