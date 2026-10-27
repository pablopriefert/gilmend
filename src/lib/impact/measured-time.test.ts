import { describe, expect, it } from "vitest";
import { makeCase } from "@/components/fixtures";
import type { CaseRecord } from "../types";
import { measureAgentTime } from "./measured-time";

function run(id: string, seconds: number, extra: Partial<CaseRecord> = {}): CaseRecord {
  const start = Date.parse("2026-10-27T16:00:00.000Z");
  return makeCase({
    id,
    recorded: { recordedOn: "2026-10-27" },
    trace: [
      { step: "Engine", at: new Date(start).toISOString() },
      { step: "Mid", at: new Date(start + (seconds * 1000) / 2).toISOString() },
      { step: "Decided", at: new Date(start + seconds * 1000).toISOString() },
    ],
    ...extra,
  });
}

describe("measureAgentTime", () => {
  it("is null when there is nothing recorded to measure, so the page says so instead of inventing a time", () => {
    expect(measureAgentTime([])).toBeNull();
    expect(measureAgentTime([makeCase()])).toBeNull();
  });

  it("measures each recorded run from the first to the last step of its trace", () => {
    const m = measureAgentTime([run("a", 30), run("b", 18), run("c", 36)])!;
    expect(m.runs.map((r) => [r.id, r.seconds])).toEqual([
      ["a", 30],
      ["b", 18],
      ["c", 36],
    ]);
    expect(m.meanSeconds).toBe(28);
    expect(m.medianSeconds).toBe(30);
    expect(m.minSeconds).toBe(18);
    expect(m.maxSeconds).toBe(36);
    expect(m.recordedOn).toBe("2026-10-27");
  });

  it("takes the middle pair for an even count", () => {
    expect(measureAgentTime([run("a", 10), run("b", 20), run("c", 30), run("d", 100)])!.medianSeconds).toBe(25);
  });

  it("ignores a live case, a demo-mode run, a run without two steps and an implausible duration", () => {
    const m = measureAgentTime([
      run("real", 30),
      makeCase({ id: "live" }),
      run("mock", 1, { engine: "demo-mock" }),
      run("short", 5, { trace: [{ step: "Only one", at: "2026-10-27T16:00:00.000Z" }] }),
      run("hung", 4000),
      run("backwards", -3),
      run("garbled", 10, { trace: [{ step: "a", at: "nope" }, { step: "b", at: "2026-10-27T16:00:10.000Z" }] }),
    ])!;
    expect(m.runs.map((r) => r.id)).toEqual(["real"]);
  });

  it("reports the latest recording day and what each run decided", () => {
    const m = measureAgentTime([
      run("a", 30),
      run("b", 20, { recorded: { recordedOn: "2026-10-29" } }),
    ])!;
    expect(m.recordedOn).toBe("2026-10-29");
    expect(m.runs[0].decision).toBe("reship");
  });
});
