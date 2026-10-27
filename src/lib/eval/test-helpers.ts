// Fixtures shared by the evaluation tests. Imported only by tests.
import type { EvalCaseResult, EvalExpectation, EvalResults, EvalRun } from "./types";

export const EXPECT_RESHIP: EvalExpectation = {
  decision: "reship",
  acceptableDecisions: ["reship", "refund"],
  carrierClaim: true,
  needsHuman: false,
  claimEligible: true,
};

export function makeRun(over: Partial<EvalRun> = {}): EvalRun {
  const base: EvalRun = {
    run: 1,
    completed: true,
    failure: null,
    decision: "reship",
    carrierClaim: true,
    needsHuman: false,
    claimEligible: true,
    claimAmountEur: 32.2,
    claimDocument: true,
    confidence: 0.9,
    guardrails: [],
    reasons: ["Clear breakage."],
    sam: { method: "sam-3.1", regions: 5, concepts: ["broken pottery"], calledByCode: false, requests: 2 },
    durationMs: 40_000,
    modelCalls: 6,
    toolCalls: 7,
    usage: { promptTokens: 10_000, completionTokens: 2_000, totalTokens: 12_000, cachedTokens: 0, callsWithUsage: 6 },
    matches: { decision: true, carrierClaim: true, needsHuman: true, claimEligible: true, all: true },
  };
  return { ...base, ...over };
}

export const MISS_MATCHES = { decision: false, carrierClaim: false, needsHuman: true, claimEligible: true, all: false };

/**
 * Two cases of three runs: the vase is met every run; the carton goes wrong once (the agent claims
 * the carrier on an intact product), so the fixture holds both an agreement and a disagreement.
 */
export function makeResults(over: Partial<EvalResults> = {}): EvalResults {
  const vase: EvalCaseResult = {
    id: "demo-1-vase-broken",
    title: "Broken vase (Colissimo): reship and claim the carrier",
    expected: EXPECT_RESHIP,
    runs: [1, 2, 3].map((run) => makeRun({ run, claimAmountEur: 32.2, durationMs: 38_000 + run * 1000 })),
  };
  const carton: EvalCaseResult = {
    id: "demo-2-carton-crushed",
    title: "Crushed carton, product intact: no claim",
    expected: { decision: "no_action", acceptableDecisions: ["no_action"], carrierClaim: false, needsHuman: false, claimEligible: false },
    runs: [
      makeRun({ run: 1, decision: "no_action", carrierClaim: false, claimEligible: false, claimAmountEur: null, claimDocument: false, sam: { method: "sam-3.1", regions: 1, concepts: ["torn cardboard"], calledByCode: true, requests: 1 } }),
      makeRun({
        run: 2,
        decision: "no_action",
        carrierClaim: true,
        claimEligible: true,
        claimAmountEur: 23,
        reasons: ["The carton is crushed, so the carrier is at fault."],
        guardrails: ["the order total is under the human-review threshold."],
        matches: { decision: true, carrierClaim: false, needsHuman: true, claimEligible: false, all: false },
      }),
      makeRun({ run: 3, decision: "no_action", carrierClaim: false, claimEligible: false, claimAmountEur: null, claimDocument: false }),
    ],
  };
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-27T15:00:00.000Z",
    engine: "muse-spark-1.3",
    model: "muse-spark-1.3",
    engineLabel: "Muse Spark 1.3 (Meta Model API)",
    runsPerCase: 3,
    command: "npm run eval -- --runs 3",
    commit: "abc1234",
    dirty: false,
    pricing: {
      inputPerMillionTokensUsd: 1.25,
      outputPerMillionTokensUsd: 4.25,
      samPerRequestUsd: 0.0025,
      source: "Meta Model API pricing page (dev.meta.ai), read 27 Oct 2026; cache discounts ignored",
    },
    estimatedCostUsd: 0.42,
    cases: [vase, carton],
    ...over,
  };
}
