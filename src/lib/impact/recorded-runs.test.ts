import path from "node:path";
import { describe, expect, it } from "vitest";
import { listShowcaseCases } from "../showcase/showcase";
import { summarizeRecordedRuns } from "../store/summary";
import { buildInsights } from "./insights";
import { measureAgentTime } from "./measured-time";
import { computeRoi, DEFAULT_INPUTS } from "./roi";

// The insights and the ROI page against the committed recordings (data/showcase/), not against
// fixtures: what a judge sees on the live site is computed from these six files. The assertions
// are invariants (the same money as the hero's "Recorded runs" figure, the same count as the
// files), so re-recording a case does not break them, but a number computed from something else does.

const env = { DAMAGE_DESK_SHOWCASE_DIR: path.join(process.cwd(), "data", "showcase") };
const RECORDED_DAY = new Date("2026-10-27T20:00:00Z");

describe("the committed recorded runs", () => {
  it("give the Insights the same money as the 'Recorded runs' figure of the hero, whenever they are read", async () => {
    const cases = await listShowcaseCases(env);
    expect(cases.length).toBeGreaterThan(0);
    const hero = summarizeRecordedRuns(cases);
    for (const now of [RECORDED_DAY, new Date("2026-12-31T00:00:00Z"), new Date("2027-06-01T00:00:00Z")]) {
      const insights = buildInsights(cases, now, { includeRecorded: true });
      expect(insights.recoverableEur).toBe(hero.recoverableEur);
      expect(insights.carriers.reduce((sum, c) => sum + c.recoverableEur, 0)).toBeCloseTo(hero.recoverableEur, 2);
      expect(insights.cases).toBe(cases.length);
    }
  });

  it("count nothing in the live numbers", async () => {
    const cases = await listShowcaseCases(env);
    const live = buildInsights(cases, RECORDED_DAY, { includeRecorded: false });
    expect(live.cases).toBe(0);
    expect(live.openClaims).toBe(0);
    expect(live.recoverableEur).toBe(0);
    expect(live.timeline.events).toEqual([]);
  });

  it("keep their deadlines as of the recording instead of expiring a few days later", async () => {
    const cases = await listShowcaseCases(env);
    const soon = buildInsights(cases, RECORDED_DAY, { includeRecorded: true }).timeline.events;
    const later = buildInsights(cases, new Date("2027-03-01T00:00:00Z"), { includeRecorded: true }).timeline.events;
    expect(soon.length).toBeGreaterThan(0);
    expect(later).toEqual(soon);
    expect(soon.every((e) => e.recordedOn !== null)).toBe(true);
  });

  it("count one decision per case that has one", async () => {
    const cases = await listShowcaseCases(env);
    const { decisions } = buildInsights(cases, RECORDED_DAY, { includeRecorded: true });
    expect(decisions.total).toBe(cases.filter((c) => c.decision !== null).length);
    expect(decisions.items.reduce((sum, d) => sum + d.count, 0)).toBe(decisions.total);
  });

  it("are measured, one duration per run, and that measure is what the calculator uses", async () => {
    const cases = await listShowcaseCases(env);
    const measured = measureAgentTime(cases);
    expect(measured).not.toBeNull();
    expect(measured!.runs).toHaveLength(cases.filter((c) => c.trace.length >= 2).length);
    for (const run of measured!.runs) {
      expect(run.seconds).toBeGreaterThan(5);
      expect(run.seconds).toBeLessThan(120);
    }
    const roi = computeRoi(DEFAULT_INPUTS, measured);
    expect(roi.time.agentSecondsPerCase).toBe(measured!.meanSeconds);
  });
});
