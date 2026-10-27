import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evalDir, loadEvalResults, loadLatestEval, parseEvalResults } from "./results";
import { makeResults } from "./test-helpers";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "gilmend-eval-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, value: unknown) => writeFileSync(path.join(dir, name), JSON.stringify(value));

describe("parseEvalResults", () => {
  it("accepts what scripts/eval.ts writes (a JSON round trip)", () => {
    const results = makeResults();
    expect(parseEvalResults(JSON.parse(JSON.stringify(results)))).toEqual(results);
  });

  it("accepts a run without token usage and an evaluation without a price", () => {
    const results = makeResults({ pricing: null, estimatedCostUsd: null });
    results.cases[0].runs[0].usage = null;
    expect(parseEvalResults(JSON.parse(JSON.stringify(results)))).toEqual(results);
  });

  it("refuses the mock engine: a script is not a measurement", () => {
    expect(() => parseEvalResults({ ...makeResults(), engine: "demo-mock" })).toThrow(/engine/);
  });

  it("names the field that is wrong", () => {
    const bad = JSON.parse(JSON.stringify(makeResults()));
    bad.cases[1].runs[2].durationMs = "slow";
    expect(() => parseEvalResults(bad)).toThrow(/cases\[1\]\.runs\[2\]\.durationMs/);
    expect(() => parseEvalResults({ ...makeResults(), schemaVersion: 2 })).toThrow(/schemaVersion/);
    expect(() => parseEvalResults({ ...makeResults(), cases: [] })).toThrow(/cases/);
    expect(() => parseEvalResults("nope")).toThrow(/JSON object/);
  });

  it("refuses an expected decision that is not among the acceptable ones", () => {
    const bad = JSON.parse(JSON.stringify(makeResults()));
    bad.cases[0].expected.acceptableDecisions = ["refund"];
    expect(() => parseEvalResults(bad)).toThrow(/expected\.decision/);
  });
});

describe("loading the committed evaluations", () => {
  it("returns the most recent one by its own date, not by its file name", () => {
    write("2026-10-27-muse-spark-1.3.json", makeResults({ generatedAt: "2026-10-27T15:00:00.000Z" }));
    write("2026-10-26-zzz.json", makeResults({ generatedAt: "2026-10-28T09:00:00.000Z" }));
    expect(loadEvalResults(dir).map((l) => l.file)).toEqual(["2026-10-26-zzz.json", "2026-10-27-muse-spark-1.3.json"]);
    expect(loadLatestEval(dir)?.file).toBe("2026-10-26-zzz.json");
  });

  it("ignores files that are not JSON", () => {
    writeFileSync(path.join(dir, "README.md"), "# notes");
    write("a.json", makeResults());
    expect(loadEvalResults(dir)).toHaveLength(1);
  });

  it("is empty, not an error, when nothing was committed yet", () => {
    expect(loadLatestEval(dir)).toBeNull();
    expect(loadLatestEval(path.join(dir, "missing"))).toBeNull();
  });

  it("fails loudly, with the file name, on a broken file", () => {
    writeFileSync(path.join(dir, "broken.json"), "{ not json");
    expect(() => loadLatestEval(dir)).toThrow(/broken\.json/);
  });
});

describe("evalDir", () => {
  it("defaults to data/eval and can be redirected", () => {
    expect(evalDir({})).toBe(path.join(process.cwd(), "data", "eval"));
    expect(evalDir({ DAMAGE_DESK_EVAL_DIR: "/somewhere" })).toBe("/somewhere");
  });
});
