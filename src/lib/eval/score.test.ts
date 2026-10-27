import { describe, expect, it } from "vitest";
import {
  META_PRICING,
  costGuard,
  mayStartAnotherRun,
  median,
  parseSamNote,
  runCostUsd,
  scoreRun,
  sumUsage,
  summarizeCase,
  summarizeResults,
} from "./score";
import { EXPECT_RESHIP, makeRun } from "./test-helpers";
import type { EvalCaseResult, EvalRun } from "./types";

describe("scoreRun", () => {
  const observed = { completed: true, decision: "reship" as const, carrierClaim: true, needsHuman: false, claimEligible: true };

  it("matches when every expected field is met", () => {
    expect(scoreRun(EXPECT_RESHIP, observed)).toEqual({
      decision: true,
      carrierClaim: true,
      needsHuman: true,
      claimEligible: true,
      all: true,
    });
  });

  it("accepts any of the acceptable decisions, not only the primary one", () => {
    expect(scoreRun(EXPECT_RESHIP, { ...observed, decision: "refund" }).decision).toBe(true);
    expect(scoreRun(EXPECT_RESHIP, { ...observed, decision: "no_action" }).decision).toBe(false);
  });

  it("reports each missed field on its own and fails `all`", () => {
    const m = scoreRun(EXPECT_RESHIP, { ...observed, carrierClaim: false, needsHuman: true });
    expect(m).toMatchObject({ decision: true, carrierClaim: false, needsHuman: false, claimEligible: true, all: false });
  });

  it("credits nothing to a run that did not finish, not even a field its fallback answer happens to agree on", () => {
    // runAgent's fallback for a timeout is no_action with a human: on a case that expects exactly
    // that, every field would match. A timeout is not a decision (review of 27 Oct 2026).
    const expectsNoAction = { ...EXPECT_RESHIP, decision: "no_action" as const, acceptableDecisions: ["no_action" as const], carrierClaim: false, needsHuman: true, claimEligible: false };
    const m = scoreRun(expectsNoAction, { completed: false, decision: "no_action", carrierClaim: false, needsHuman: true, claimEligible: false });
    expect(m).toEqual({ decision: false, carrierClaim: false, needsHuman: false, claimEligible: false, all: false });
  });

  it("treats a missing observation (null) as a miss", () => {
    const m = scoreRun(EXPECT_RESHIP, { completed: false, decision: null, carrierClaim: null, needsHuman: null, claimEligible: null });
    expect(m).toMatchObject({ decision: false, carrierClaim: false, needsHuman: false, claimEligible: false, all: false });
  });
});

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("parseSamNote", () => {
  it("reads one concept", () => {
    const note =
      'SAM 3.1 outlined 1 region matching "torn cardboard" (confidence 0.74). The outline shows what SAM matched for these concepts, not the damage itself; it is not a damage verdict.';
    expect(parseSamNote([{ method: "sam-3.1", note }])).toEqual({ method: "sam-3.1", regions: 1, concepts: ["torn cardboard"] });
  });

  it("reads several concepts", () => {
    const note = 'SAM 3.1 outlined 5 regions from 2 concepts: "broken pottery" 3, "ceramic vase" 2 (confidence 0.9, 0.8).';
    expect(parseSamNote([{ method: "sam-3.1", note }])).toEqual({
      method: "sam-3.1",
      regions: 5,
      concepts: ["broken pottery", "ceramic vase"],
    });
  });

  it("finds nothing when SAM did not run or found no region", () => {
    expect(parseSamNote([{ method: "none", note: 'SAM sam-3.1 found no region matching "crack": the raw photo is used as evidence.' }])).toEqual({
      method: "none",
      regions: 0,
      concepts: [],
    });
    expect(parseSamNote([])).toEqual({ method: "none", regions: 0, concepts: [] });
  });
});

describe("sumUsage", () => {
  it("adds the usage blocks of the model calls, with cached tokens", () => {
    const usage = sumUsage([
      { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_tokens_details: { cached_tokens: 400 } },
      undefined,
      { prompt_tokens: 2000, completion_tokens: 300 },
    ]);
    expect(usage).toEqual({ promptTokens: 3000, completionTokens: 400, totalTokens: 3400, cachedTokens: 400, callsWithUsage: 2 });
  });

  it("is null, not zero, when the provider returned no usage at all", () => {
    expect(sumUsage([undefined, null])).toBeNull();
  });
});

describe("cost", () => {
  it("prices tokens and SAM requests", () => {
    const run = makeRun({ usage: { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000, cachedTokens: 0, callsWithUsage: 1 }, sam: { ...makeRun().sam, requests: 2 } });
    expect(runCostUsd(run, META_PRICING)).toBeCloseTo(1.25 + 4.25 + 0.005, 6);
  });

  it("is unknown (null) without usage", () => {
    expect(runCostUsd(makeRun({ usage: null }), META_PRICING)).toBeNull();
  });
});

describe("costGuard", () => {
  it("allows a cheap evaluation", () => {
    const g = costGuard({ firstRunCostUsd: 0.05, totalRuns: 18, limitUsd: 5, yes: false });
    expect(g.allowed).toBe(true);
    expect(g.estimateUsd).toBeCloseTo(0.9, 6);
  });

  it("refuses above the limit unless --yes is given", () => {
    expect(costGuard({ firstRunCostUsd: 0.1, totalRuns: 60, limitUsd: 5, yes: false })).toMatchObject({ allowed: false, estimateUsd: expect.closeTo(6, 6) });
    expect(costGuard({ firstRunCostUsd: 0.1, totalRuns: 60, limitUsd: 5, yes: true }).allowed).toBe(true);
  });

  it("refuses an evaluation whose cost it cannot estimate, unless --yes is given", () => {
    expect(costGuard({ firstRunCostUsd: null, totalRuns: 18, limitUsd: 5, yes: false })).toMatchObject({ allowed: false, estimateUsd: null });
    expect(costGuard({ firstRunCostUsd: null, totalRuns: 18, limitUsd: 5, yes: true }).allowed).toBe(true);
  });
});

describe("mayStartAnotherRun", () => {
  const base = { spentUsd: 0, maxRunCostUsd: 0.1, inFlight: 0, limitUsd: 1, yes: false };

  it("allows a run while spent plus the dearest run so far stays under the limit", () => {
    expect(mayStartAnotherRun({ ...base, spentUsd: 0.85 })).toBe(true);
  });

  it("refuses a run that could take the total over the limit", () => {
    expect(mayStartAnotherRun({ ...base, spentUsd: 0.95 })).toBe(false);
  });

  it("counts the runs already under way as if each cost the dearest run", () => {
    expect(mayStartAnotherRun({ ...base, spentUsd: 0.75, inFlight: 2 })).toBe(false); // 0.75 + 3 x 0.1
    expect(mayStartAnotherRun({ ...base, spentUsd: 0.6, inFlight: 2 })).toBe(true);
  });

  it("never overrides --yes", () => {
    expect(mayStartAnotherRun({ ...base, spentUsd: 50, yes: true })).toBe(true);
  });
});

describe("summarizeCase", () => {
  const caseOf = (runs: EvalRun[]): EvalCaseResult => ({ id: "demo-1", title: "Broken vase", expected: EXPECT_RESHIP, runs });

  it("counts agreement, variance and medians over the runs", () => {
    const miss = makeRun({
      run: 3,
      decision: "no_action",
      carrierClaim: false,
      claimAmountEur: null,
      durationMs: 60_000,
      matches: { decision: false, carrierClaim: false, needsHuman: true, claimEligible: true, all: false },
    });
    const s = summarizeCase(caseOf([makeRun({ run: 1 }), makeRun({ run: 2, claimAmountEur: 34.5, durationMs: 50_000 }), miss]));
    expect(s.runs).toBe(3);
    expect(s.matched).toMatchObject({ decision: 2, carrierClaim: 2, needsHuman: 3, claimEligible: 3, all: 2 });
    expect(s.decisionCounts).toEqual({ reship: 2, no_action: 1 });
    expect(s.modal).toEqual({ decision: "reship", count: 2 });
    expect(s.carrierClaimCount).toBe(2);
    expect(s.stable).toBe(false);
    expect(s.claimAmountEur).toEqual({ min: 32.2, max: 34.5 });
    expect(s.medianDurationMs).toBe(50_000);
    expect(s.totalTokens).toBe(36_000);
  });

  it("is stable when every run gives the same decision, claim and review answer", () => {
    const s = summarizeCase(caseOf([makeRun({ run: 1 }), makeRun({ run: 2, durationMs: 45_000 })]));
    expect(s.stable).toBe(true);
    expect(s.matched.all).toBe(2);
  });

  it("takes the SAM median over the runs that outlined something only", () => {
    const none = makeRun({ run: 2, sam: { method: "none", regions: 0, concepts: [], calledByCode: false, requests: 3 } });
    const s = summarizeCase(caseOf([makeRun({ run: 1 }), none]));
    expect(s.medianSamRegions).toBe(5);
    expect(s.samRuns).toBe(1);
  });

  it("counts a run that did not finish apart, never as a decision, a claim or a human review", () => {
    // The timed-out run as run-case.ts stores it: nothing observed. A file written before that fix
    // could still hold the fallback answer, so the summary must not trust those fields either.
    const timedOut = makeRun({
      run: 3,
      completed: false,
      failure: "Agent did not reach a decision in time",
      decision: "no_action",
      carrierClaim: false,
      needsHuman: true,
      claimEligible: false,
      claimAmountEur: null,
      matches: { decision: false, carrierClaim: false, needsHuman: false, claimEligible: false, all: false },
    });
    const s = summarizeCase(caseOf([makeRun({ run: 1 }), makeRun({ run: 2 }), timedOut]));
    expect(s.completed).toBe(2);
    expect(s.notFinished).toBe(1);
    expect(s.decisionCounts).toEqual({ reship: 2 });
    expect(s.needsHumanCount).toBe(0);
    expect(s.matched).toMatchObject({ decision: 2, carrierClaim: 2, needsHuman: 2, claimEligible: 2, all: 2 });
    // One run that gave nothing is not "the same answer every run".
    expect(s.stable).toBe(false);
  });

  it("counts the runs where the code, not the model, asked SAM", () => {
    const byCode = (run: number) => makeRun({ run, sam: { method: "sam-3.1", regions: 1, concepts: ["torn cardboard"], calledByCode: true, requests: 1 } });
    const s = summarizeCase(caseOf([byCode(1), makeRun({ run: 2 }), byCode(3)]));
    expect(s.samCalledByCodeRuns).toBe(2);
    expect(s.samRuns).toBe(3);
  });

  it("leaves tokens null when no run returned usage", () => {
    expect(summarizeCase(caseOf([makeRun({ usage: null })])).totalTokens).toBeNull();
  });
});

describe("summarizeResults", () => {
  it("adds the cases up and says which were always right and which were stable", () => {
    const right = (id: string): EvalCaseResult => ({ id, title: id, expected: EXPECT_RESHIP, runs: [makeRun({ run: 1 }), makeRun({ run: 2 })] });
    const wrongButStable: EvalCaseResult = {
      id: "c3",
      title: "c3",
      expected: EXPECT_RESHIP,
      runs: [1, 2].map((run) =>
        makeRun({ run, decision: "no_action", matches: { decision: false, carrierClaim: true, needsHuman: true, claimEligible: true, all: false } }),
      ),
    };
    const s = summarizeResults({ cases: [right("c1"), right("c2"), wrongButStable] });
    expect(s.totalRuns).toBe(6);
    expect(s.matched.all).toBe(4);
    expect(s.matched.decision).toBe(4);
    expect(s.casesAlwaysRight).toBe(2);
    expect(s.casesStable).toBe(3);
    expect(s.medianDurationMs).toBe(40_000);
    expect(s.totalTokens).toBe(72_000);
    expect(s.samRequests).toBe(12);
    expect(s.cachedTokens).toBe(0);
    expect(s.runsWithoutUsage).toBe(0);
  });
});
