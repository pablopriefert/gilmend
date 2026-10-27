import type { DecisionKind, Engine } from "../types";

// The shape of a committed evaluation (data/eval/<date>-<engine>.json), written by
// scripts/eval.ts and read by the /eval page. Everything in it is fictitious data (the six demo
// cases) plus counts and timings: no customer text, no reply, no key.

/** What the demo case file says we expect (data/demo-cases.json, `expected`). */
export interface EvalExpectation {
  decision: DecisionKind;
  /** Decisions we would also accept (the merchant policy can go either way, e.g. reship or refund). */
  acceptableDecisions: DecisionKind[];
  carrierClaim: boolean;
  needsHuman: boolean;
  /** Whether the deterministic claim maths calls the claim eligible. */
  claimEligible: boolean;
}

/** Token counts the provider returned, summed over the model calls of one run. */
export interface EvalUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Prompt tokens served from the provider's cache, when it says so. */
  cachedTokens: number;
  /** Model calls that came back with a `usage` block (fewer than `modelCalls` = incomplete). */
  callsWithUsage: number;
}

/** What SAM 3.1 outlined on the run's photos (the item or the box, not the damage itself). */
export interface EvalSam {
  method: "sam-3.1" | "none";
  regions: number;
  /** Concepts that matched, e.g. "broken pottery". */
  concepts: string[];
  /** True when the code, not the model, asked SAM (the evidence fallback, see run-agent.ts). */
  calledByCode: boolean;
  /** HTTP requests sent to SAM during the run (counted at the fetch call, not guessed). */
  requests: number;
}

/** Which expected fields the run met. `all` is false for a run that did not finish. */
export interface EvalMatches {
  decision: boolean;
  carrierClaim: boolean;
  needsHuman: boolean;
  claimEligible: boolean;
  all: boolean;
}

export interface EvalRun {
  /** 1-based. */
  run: number;
  /** False when the agent could not reach a decision (timeout, provider error): counted as a miss. */
  completed: boolean;
  failure: string | null;
  decision: DecisionKind | null;
  carrierClaim: boolean | null;
  needsHuman: boolean | null;
  /** "No claim computed" (a blurry photo skips compute_claim) counts as not eligible. */
  claimEligible: boolean | null;
  /** Compensation cap computed by code when the claim is eligible, else null. */
  claimAmountEur: number | null;
  /** Whether a carrier claim PDF was produced. */
  claimDocument: boolean;
  confidence: number | null;
  /** Guardrail adjustments the code made to the model's decision (text of the trace line). */
  guardrails: string[];
  /** The model's own reasons, trimmed; shown only for runs that missed an expectation. */
  reasons: string[];
  sam: EvalSam;
  durationMs: number;
  modelCalls: number;
  /** Tool calls the model asked for (the code's own fallback calls are not counted here). */
  toolCalls: number;
  /** null when the provider returned no `usage` at all. */
  usage: EvalUsage | null;
  matches: EvalMatches;
}

export interface EvalCaseResult {
  id: string;
  title: string;
  expected: EvalExpectation;
  runs: EvalRun[];
}

/** Prices used for the cost estimate, written next to it so the figure can be checked. */
export interface EvalPricing {
  inputPerMillionTokensUsd: number;
  outputPerMillionTokensUsd: number;
  samPerRequestUsd: number;
  /** Where the prices come from and when they were read. */
  source: string;
}

export interface EvalResults {
  schemaVersion: 1;
  /** ISO date-time the evaluation started. */
  generatedAt: string;
  engine: Exclude<Engine, "demo-mock">;
  model: string;
  /** Label of the engine as the app writes it ("Muse Spark 1.3 (Meta Model API)"). */
  engineLabel: string;
  runsPerCase: number;
  /** The exact command that reproduces it. */
  command: string;
  /** Short git commit the code was at (null outside a git checkout). */
  commit: string | null;
  /** True when the working tree had uncommitted changes while it ran. */
  dirty: boolean;
  pricing: EvalPricing | null;
  /** Estimated cost of the whole evaluation, upper bound (cache discounts ignored); null when no usage came back. */
  estimatedCostUsd: number | null;
  cases: EvalCaseResult[];
}
