import type { DecisionKind, Evidence } from "../types";
import type {
  EvalCaseResult,
  EvalExpectation,
  EvalMatches,
  EvalPricing,
  EvalResults,
  EvalRun,
  EvalSam,
  EvalUsage,
} from "./types";

// The scoring of an evaluation, kept apart from the script that runs the agent and from the page
// that shows the result, so each of them is a few lines and this part is tested on its own.
// Nothing here calls a model.

/**
 * Prices of Muse Spark 1.3 (Standard mode) on the Meta Model API: $1.25 per million input tokens
 * and $4.25 per million output tokens ("pay-as-you-go pricing starts at", dev.meta.ai/resources/blog/
 * build-with-muse-spark, read 27 Oct 2026), and $2.50 per 1,000 SAM images (a comment of
 * src/lib/evidence/mark-damage.ts, from the same documentation, not re-read since). Cached input is
 * billed lower by Meta, but the page we read gave no figure we could check, so the estimate ignores
 * it. That makes it an estimate at the published starting price and nothing more: a cache discount
 * would lower it, a higher price tier would raise it, and we cannot say which way the truth lies
 * (review of 27 Oct 2026: it was first called an "upper bound", which nothing verifies).
 */
export const META_PRICING: EvalPricing = {
  inputPerMillionTokensUsd: 1.25,
  outputPerMillionTokensUsd: 4.25,
  samPerRequestUsd: 2.5 / 1000,
  source:
    "Meta Model API pricing page (dev.meta.ai), \"starts at\" prices, read 27 Oct 2026; SAM price as quoted in src/lib/evidence/mark-damage.ts, not re-checked; cache discounts ignored",
};

/** Observed values of one run, before they are compared with what we expected. */
export interface Observed {
  completed: boolean;
  decision: DecisionKind | null;
  carrierClaim: boolean | null;
  needsHuman: boolean | null;
  claimEligible: boolean | null;
}

/**
 * Compare a run with the case's expectation. A decision counts when it is one of the acceptable
 * ones (the merchant policy can go either way on some cases), not only the primary one. A run that
 * did not finish matches nothing, field by field: runAgent's fallback answer for a timeout
 * ("no_action", needs a human) is not something the agent observed, and on a case that expects
 * no_action it would otherwise be credited as a correct decision (review of 27 Oct 2026).
 */
export function scoreRun(expected: EvalExpectation, observed: Observed): EvalMatches {
  if (!observed.completed) {
    return { decision: false, carrierClaim: false, needsHuman: false, claimEligible: false, all: false };
  }
  const decision = observed.decision !== null && expected.acceptableDecisions.includes(observed.decision);
  const carrierClaim = observed.carrierClaim === expected.carrierClaim;
  const needsHuman = observed.needsHuman === expected.needsHuman;
  const claimEligible = observed.claimEligible === expected.claimEligible;
  return {
    decision,
    carrierClaim,
    needsHuman,
    claimEligible,
    all: decision && carrierClaim && needsHuman && claimEligible,
  };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * What a mark_damage evidence note says SAM outlined. The note is written by markDamage in a fixed
 * shape ("SAM 3.1 outlined 2 regions matching "x"" or "... from 2 concepts: "a" 1, "b" 1"); this
 * reads it back rather than changing the evidence type for the sake of an evaluation. A note that
 * does not match (no SAM, a failed call) yields no regions.
 */
export function parseSamNote(evidence: readonly Pick<Evidence, "method" | "note">[]): Pick<EvalSam, "method" | "regions" | "concepts"> {
  let regions = 0;
  const concepts: string[] = [];
  let method: EvalSam["method"] = "none";
  for (const e of evidence) {
    if (e.method !== "sam-3.1") continue;
    const outlined = e.note.match(/outlined (\d+) regions?/);
    if (!outlined) continue;
    method = "sam-3.1";
    regions += Number(outlined[1]);
    const several = e.note.match(/from \d+ concepts: ((?:"[^"]+" \d+(?:, )?)+)/);
    if (several) {
      for (const m of several[1].matchAll(/"([^"]+)" \d+/g)) concepts.push(m[1]);
    } else {
      const one = e.note.match(/matching "([^"]+)"/);
      if (one) concepts.push(one[1]);
    }
  }
  return { method, regions, concepts: [...new Set(concepts)] };
}

/** The part of an OpenAI-style `usage` block this evaluation reads. */
export interface UsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

/** Sum the `usage` blocks of the model calls of a run. null when the provider never sent one. */
export function sumUsage(usages: readonly (UsageLike | null | undefined)[]): EvalUsage | null {
  const present = usages.filter((u): u is NonNullable<typeof u> => Boolean(u));
  if (present.length === 0) return null;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let cachedTokens = 0;
  for (const u of present) {
    const p = u.prompt_tokens ?? 0;
    const c = u.completion_tokens ?? 0;
    promptTokens += p;
    completionTokens += c;
    totalTokens += u.total_tokens ?? p + c;
    cachedTokens += u.prompt_tokens_details?.cached_tokens ?? 0;
  }
  return { promptTokens, completionTokens, totalTokens, cachedTokens, callsWithUsage: present.length };
}

/** Cost of one run in dollars, or null when no usage came back (the cost is then unknown, not zero). */
export function runCostUsd(run: Pick<EvalRun, "usage" | "sam">, pricing: EvalPricing): number | null {
  if (!run.usage) return null;
  return (
    (run.usage.promptTokens * pricing.inputPerMillionTokensUsd +
      run.usage.completionTokens * pricing.outputPerMillionTokensUsd) /
      1_000_000 +
    run.sam.requests * pricing.samPerRequestUsd
  );
}

export interface CostGuard {
  /** Projected cost of the whole evaluation, null when it cannot be estimated. */
  estimateUsd: number | null;
  /** False: the script stops before the other runs unless --yes was given. */
  allowed: boolean;
  reason: string;
}

/**
 * The cost guard: from what the first run cost, project the whole evaluation and refuse above the
 * limit unless the person said --yes. An unknown cost (no usage returned, no price for this engine)
 * is refused too: spending without being able to say how much is exactly what the guard is for.
 */
export function costGuard(opts: {
  firstRunCostUsd: number | null;
  totalRuns: number;
  limitUsd: number;
  yes: boolean;
}): CostGuard {
  const { firstRunCostUsd, totalRuns, limitUsd, yes } = opts;
  if (firstRunCostUsd === null) {
    return yes
      ? { estimateUsd: null, allowed: true, reason: "The cost cannot be estimated (no token usage or price for this engine); continuing because of --yes." }
      : { estimateUsd: null, allowed: false, reason: "The cost cannot be estimated (no token usage or price for this engine). Re-run with --yes to spend anyway." };
  }
  const estimateUsd = firstRunCostUsd * totalRuns;
  if (estimateUsd <= limitUsd) {
    return { estimateUsd, allowed: true, reason: `Estimated cost $${estimateUsd.toFixed(2)} for ${totalRuns} runs, under the $${limitUsd.toFixed(2)} limit.` };
  }
  return yes
    ? { estimateUsd, allowed: true, reason: `Estimated cost $${estimateUsd.toFixed(2)} is over the $${limitUsd.toFixed(2)} limit; continuing because of --yes.` }
    : { estimateUsd, allowed: false, reason: `Estimated cost $${estimateUsd.toFixed(2)} for ${totalRuns} runs is over the $${limitUsd.toFixed(2)} limit. Re-run with --yes, or with fewer --runs.` };
}

/**
 * The running guard, checked before every run after the first. costGuard projects from one run, and
 * the first task is not always a typical one (case 1 is the most expensive at about 53k tokens, a
 * blurry-photo case about 22k), and nothing re-checked the spending once it had passed. This one
 * keeps the money actually spent and assumes the next run, and each one already under way, costs as
 * much as the dearest run seen so far. It never overrides --yes, which means "spend anyway".
 */
export function mayStartAnotherRun(opts: {
  spentUsd: number;
  maxRunCostUsd: number;
  inFlight: number;
  limitUsd: number;
  yes: boolean;
}): boolean {
  if (opts.yes) return true;
  return opts.spentUsd + (opts.inFlight + 1) * opts.maxRunCostUsd <= opts.limitUsd;
}

// ---- summaries ---------------------------------------------------------------------------------

export interface CaseSummary {
  id: string;
  title: string;
  expected: EvalExpectation;
  runs: number;
  /** Runs where the agent reached a decision. */
  completed: number;
  /** Runs that did not finish (timeout, provider error): counted apart, never as a decision. */
  notFinished: number;
  matched: { decision: number; carrierClaim: number; needsHuman: number; claimEligible: number; all: number };
  /** Decisions of the runs that finished (an unfinished run's fallback answer is not one). */
  decisionCounts: Partial<Record<DecisionKind, number>>;
  /** Runs that ended with a carrier claim. */
  carrierClaimCount: number;
  /** Runs that asked for a human. */
  needsHumanCount: number;
  /** Most frequent decision and how many runs chose it ("reship, 3 of 3"). */
  modal: { decision: DecisionKind; count: number } | null;
  /** True when every run gave the same decision, carrier-claim and human-review answer. */
  stable: boolean;
  /** Smallest and largest compensation cap seen across the runs that computed one. */
  claimAmountEur: { min: number; max: number } | null;
  medianDurationMs: number | null;
  medianToolCalls: number | null;
  /** Median number of SAM regions on the runs that outlined something; null when none did. */
  medianSamRegions: number | null;
  samRuns: number;
  /** Runs where the code, not the model, asked SAM (the evidence fallback in run-agent.ts). */
  samCalledByCodeRuns: number;
  totalTokens: number | null;
}

export function summarizeCase(c: EvalCaseResult): CaseSummary {
  const runs = c.runs;
  const count = (pick: (r: EvalRun) => boolean) => runs.filter(pick).length;
  const decisionCounts: Partial<Record<DecisionKind, number>> = {};
  // Only finished runs: runAgent's fallback for a timeout ("no_action") would otherwise show up as
  // something the agent decided.
  for (const r of runs) if (r.completed && r.decision) decisionCounts[r.decision] = (decisionCounts[r.decision] ?? 0) + 1;
  const modalEntry = (Object.entries(decisionCounts) as [DecisionKind, number][]).sort((a, b) => b[1] - a[1])[0];
  const key = (r: EvalRun) => `${r.completed}|${r.decision}|${r.carrierClaim}|${r.needsHuman}`;
  const amounts = runs.map((r) => r.claimAmountEur).filter((a): a is number => a !== null);
  const sam = runs.filter((r) => r.sam.regions > 0).map((r) => r.sam.regions);
  const tokens = runs.map((r) => r.usage?.totalTokens).filter((t): t is number => typeof t === "number");
  return {
    id: c.id,
    title: c.title,
    expected: c.expected,
    runs: runs.length,
    completed: count((r) => r.completed),
    notFinished: count((r) => !r.completed),
    matched: {
      decision: count((r) => r.matches.decision),
      carrierClaim: count((r) => r.matches.carrierClaim),
      needsHuman: count((r) => r.matches.needsHuman),
      claimEligible: count((r) => r.matches.claimEligible),
      all: count((r) => r.matches.all),
    },
    decisionCounts,
    carrierClaimCount: count((r) => r.completed && r.carrierClaim === true),
    needsHumanCount: count((r) => r.completed && r.needsHuman === true),
    modal: modalEntry ? { decision: modalEntry[0], count: modalEntry[1] } : null,
    // A run that did not finish is not an answer, so a case with one is never "the same every run".
    stable: runs.length > 0 && runs.every((r) => r.completed) && new Set(runs.map(key)).size === 1,
    claimAmountEur: amounts.length ? { min: Math.min(...amounts), max: Math.max(...amounts) } : null,
    medianDurationMs: median(runs.map((r) => r.durationMs)),
    medianToolCalls: median(runs.map((r) => r.toolCalls)),
    medianSamRegions: median(sam),
    samRuns: sam.length,
    samCalledByCodeRuns: count((r) => r.sam.calledByCode),
    totalTokens: tokens.length ? tokens.reduce((a, b) => a + b, 0) : null,
  };
}

export interface EvalSummary {
  cases: CaseSummary[];
  totalRuns: number;
  completedRuns: number;
  matched: CaseSummary["matched"];
  /** Cases whose runs all met every expected field. */
  casesAlwaysRight: number;
  /** Cases whose runs all gave the same decision, claim and human-review answer (right or wrong). */
  casesStable: number;
  medianDurationMs: number | null;
  totalTokens: number | null;
  /** Prompt tokens the provider says were served from its cache (already inside totalTokens). */
  cachedTokens: number;
  /** Runs that came back with no token usage at all (the totals then undercount). */
  runsWithoutUsage: number;
  samRequests: number;
}

export function summarizeResults(results: Pick<EvalResults, "cases">): EvalSummary {
  const cases = results.cases.map(summarizeCase);
  const runs = results.cases.flatMap((c) => c.runs);
  const sum = (pick: (c: CaseSummary) => number) => cases.reduce((total, c) => total + pick(c), 0);
  const tokens = runs.map((r) => r.usage?.totalTokens).filter((t): t is number => typeof t === "number");
  return {
    cases,
    totalRuns: runs.length,
    completedRuns: sum((c) => c.completed),
    matched: {
      decision: sum((c) => c.matched.decision),
      carrierClaim: sum((c) => c.matched.carrierClaim),
      needsHuman: sum((c) => c.matched.needsHuman),
      claimEligible: sum((c) => c.matched.claimEligible),
      all: sum((c) => c.matched.all),
    },
    casesAlwaysRight: cases.filter((c) => c.runs > 0 && c.matched.all === c.runs).length,
    casesStable: cases.filter((c) => c.stable).length,
    medianDurationMs: median(runs.map((r) => r.durationMs)),
    totalTokens: tokens.length ? tokens.reduce((a, b) => a + b, 0) : null,
    cachedTokens: runs.reduce((total, r) => total + (r.usage?.cachedTokens ?? 0), 0),
    runsWithoutUsage: runs.filter((r) => !r.usage).length,
    samRequests: runs.reduce((total, r) => total + r.sam.requests, 0),
  };
}
