import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditText, carrierEmails } from "../showcase/audit";
import { loadDemoCases } from "../store/demo-cases";
import { loadEvalResults } from "./results";
import { scoreRun } from "./score";

// What must be true of every evaluation that is committed to a public repository and shown on a
// public page (data/eval/*.json). The folder may be empty (no evaluation run yet): then these
// tests have nothing to check, and the page says so.

const DIR = path.join(process.cwd(), "data", "eval");
const committed = loadEvalResults(DIR);
const allowedEmails = carrierEmails(readFileSync(path.join(process.cwd(), "data", "carriers.json"), "utf8"));
const demos = loadDemoCases(new Date("2026-10-27T12:00:00.000Z"));

it("every file of data/eval parses as an evaluation (a broken one fails this file at import)", () => {
  expect(Array.isArray(committed)).toBe(true);
});

describe.each(committed.map((c) => [c.file, c.results] as const))("committed evaluation %s", (file, results) => {
  it("holds no key, no local path, no real e-mail address", () => {
    const text = readFileSync(path.join(DIR, file), "utf8");
    expect(auditText(text, allowedEmails, { longTokens: false }), file).toEqual([]);
  });

  it("is a real engine, never the mock", () => {
    expect(results.engine).not.toBe("demo-mock");
    expect(results.engineLabel).not.toMatch(/demo/i);
  });

  it("has runsPerCase runs for each case, and the cases are the demo cases", () => {
    for (const c of results.cases) {
      expect(demos.map((d) => d.id), c.id).toContain(c.id);
      expect(c.runs, c.id).toHaveLength(results.runsPerCase);
      expect(c.runs.map((r) => r.run), c.id).toEqual(Array.from({ length: results.runsPerCase }, (_, i) => i + 1));
    }
  });

  it("was scored against the expectations the demo cases state today (re-run it if they changed)", () => {
    for (const c of results.cases) {
      const demo = demos.find((d) => d.id === c.id)!;
      expect(c.expected, c.id).toEqual({
        decision: demo.expected.decision,
        acceptableDecisions: demo.expected.acceptableDecisions,
        carrierClaim: demo.expected.carrierClaim,
        needsHuman: demo.expected.needsHuman,
        claimEligible: demo.expected.claimEligible,
      });
    }
  });

  it("stores matches that are exactly what the scoring gives for the observed values (no hand edit)", () => {
    for (const c of results.cases) {
      for (const r of c.runs) {
        expect(r.matches, `${c.id} run ${r.run}`).toEqual(
          scoreRun(c.expected, {
            completed: r.completed,
            decision: r.decision,
            carrierClaim: r.carrierClaim,
            needsHuman: r.needsHuman,
            claimEligible: r.claimEligible,
          }),
        );
      }
    }
  });
});
