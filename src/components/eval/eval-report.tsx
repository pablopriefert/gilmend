import { AlertTriangle, CheckCircle2, FlaskConical, GitCommitHorizontal, Terminal, XCircle } from "lucide-react";
import { summarizeResults, type CaseSummary } from "@/lib/eval/score";
import type { EvalCaseResult, EvalResults, EvalRun } from "@/lib/eval/types";
import type { DecisionKind } from "@/lib/types";
import { Eyebrow, Fact, Note, Panel, Pill, riseStyle } from "../case/ui";
import { DECISION_LABEL, formatDateTime, formatEur } from "../format";

// The /eval page: the latest committed evaluation (data/eval/*.json, written by scripts/eval.ts),
// shown case by case with what we expected, what the agent did, and how much it varied between runs.
// Server component, no state. The framing is part of the page, not a footnote: six cases times a few
// runs is a sanity check on the demo, and the page says so before it shows a single figure.

const yesNo = (b: boolean) => (b ? "Yes" : "No");
const seconds = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);
const outOf = (n: number, total: number) => `${n} of ${total} ${total === 1 ? "run" : "runs"}`;
const percent = (n: number, total: number) => (total === 0 ? "" : ` (${Math.round((n / total) * 100)}%)`);
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

function expectedDecision(c: CaseSummary): string {
  return c.expected.acceptableDecisions.map((d) => DECISION_LABEL[d]).join(" or ");
}

function observedDecisions(counts: Partial<Record<DecisionKind, number>>): string {
  const entries = Object.entries(counts) as [DecisionKind, number][];
  if (entries.length === 0) return "No decision";
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `${DECISION_LABEL[d]} ×${n}`)
    .join(", ");
}

function amountRange(c: CaseSummary): string {
  if (!c.claimAmountEur) return "No claim amount";
  const { min, max } = c.claimAmountEur;
  return min === max ? formatEur(min) : `${formatEur(min)} to ${formatEur(max)}`;
}

function missedFields(run: EvalRun): string[] {
  const missed: string[] = [];
  if (!run.matches.decision) missed.push("decision");
  if (!run.matches.carrierClaim) missed.push("carrier claim");
  if (!run.matches.needsHuman) missed.push("human review");
  if (!run.matches.claimEligible) missed.push("claim eligibility");
  return missed;
}

function RunPill({ run }: { run: EvalRun }) {
  const what = run.completed
    ? `${run.decision ? DECISION_LABEL[run.decision] : "No decision"}${run.carrierClaim ? ", claim" : ""}${run.needsHuman ? ", human" : ""}`
    : "Not finished";
  if (run.matches.all) {
    return (
      <Pill tone="ok" icon={CheckCircle2}>
        Run {run.run}: {what}
      </Pill>
    );
  }
  const missed = missedFields(run);
  return (
    <Pill tone="warn" icon={AlertTriangle}>
      Run {run.run}: {what}. Missed {missed.length > 0 ? missed.join(", ") : "the run did not finish"}
    </Pill>
  );
}

function CaseCard({ result, summary, index }: { result: EvalCaseResult; summary: CaseSummary; index: number }) {
  const { runs, matched } = summary;
  const all = matched.all === runs;
  const none = matched.all === 0;
  const missedRuns = result.runs.filter((r) => !r.matches.all);
  const headingId = `eval-case-${summary.id}`;
  return (
    <li
      style={riseStyle(index)}
      className="animate-rise rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted">{summary.id}</p>
          <h3 id={headingId} className="mt-1 text-base font-semibold tracking-tight text-ink">
            {summary.title}
          </h3>
        </div>
        <Pill tone={all ? "ok" : none ? "danger" : "warn"} icon={all ? CheckCircle2 : none ? XCircle : AlertTriangle}>
          {matched.all} of {runs} {runs === 1 ? "run meets" : "runs meet"} every expectation
        </Pill>
      </div>

      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        <section aria-label="What we expected">
          <Eyebrow>Expected</Eyebrow>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Decision">{expectedDecision(summary)}</Fact>
            <Fact label="Carrier claim">{yesNo(summary.expected.carrierClaim)}</Fact>
            <Fact label="Human review">{yesNo(summary.expected.needsHuman)}</Fact>
            <Fact label="Claim eligible (by code)">{yesNo(summary.expected.claimEligible)}</Fact>
          </dl>
        </section>
        <section aria-label="What the agent did">
          <Eyebrow>Observed</Eyebrow>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Decision">
              {observedDecisions(summary.decisionCounts)}
              <span className="block text-xs text-muted">{outOf(matched.decision, runs)} acceptable</span>
            </Fact>
            <Fact label="Carrier claim kept">
              <span className="tabular">{outOf(summary.carrierClaimCount, runs)}</span>
              <span className="block text-xs text-muted">{outOf(matched.carrierClaim, runs)} as expected</span>
            </Fact>
            <Fact label="Human review asked">
              <span className="tabular">{outOf(summary.needsHumanCount, runs)}</span>
              <span className="block text-xs text-muted">{outOf(matched.needsHuman, runs)} as expected</span>
            </Fact>
            <Fact label="Claim amount (by code)">
              <span className="tabular">{amountRange(summary)}</span>
            </Fact>
            <Fact label="Median duration">
              <span className="tabular">{seconds(summary.medianDurationMs)}</span>
            </Fact>
            <Fact label="SAM outline">
              {summary.samRuns === 0 ? (
                "None"
              ) : (
                <span className="tabular">
                  {summary.medianSamRegions} {summary.medianSamRegions === 1 ? "region" : "regions"} (median), {outOf(summary.samRuns, runs)}
                </span>
              )}
            </Fact>
          </dl>
        </section>
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          {summary.stable ? "Same answer every run" : "The runs differ"}
        </p>
        <ol aria-label={`Runs of ${summary.title}`} className="mt-3 flex flex-wrap gap-2">
          {result.runs.map((run) => (
            <li key={run.run} className="max-w-full">
              <RunPill run={run} />
            </li>
          ))}
        </ol>
      </div>

      {missedRuns.length > 0 && (
        <details className="mt-4 rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-ink-soft">
          <summary className="cursor-pointer font-medium text-ink">
            What the agent said in the {missedRuns.length === 1 ? "run" : `${missedRuns.length} runs`} that missed
          </summary>
          <ul className="mt-3 space-y-3">
            {missedRuns.map((run) => (
              <li key={run.run}>
                <p className="font-medium text-ink">Run {run.run}</p>
                {run.failure && <p className="mt-1">{run.failure}</p>}
                {run.reasons.length > 0 && (
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {run.reasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                )}
                {run.guardrails.length > 0 && (
                  <p className="mt-1 text-muted">Guardrail: {run.guardrails.join(" ")}</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function Tile({ label, figure, caption }: { label: string; figure: string; caption: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="tabular mt-2 font-display text-4xl leading-none text-ink">{figure}</p>
      <p className="mt-3 text-sm leading-snug text-muted">{caption}</p>
    </div>
  );
}

/** The framing that comes before any figure: what this evaluation is, and what it is not. */
function Framing({ cases, runsPerCase }: { cases: number; runsPerCase: number }) {
  return (
    <Note tone="warn" icon={FlaskConical}>
      <strong>
        {cases} cases × {runsPerCase} {runsPerCase === 1 ? "run" : "runs"}: a sanity check on the demo, not a benchmark.
      </strong>{" "}
      That is too few runs to put a rate on, so a case that went {runsPerCase} of {runsPerCase} can still fail one run in ten. These
      are also the six cases the agent was built and tuned on (its prompt, guardrails and SAM concepts were adjusted while looking
      at them), so this shows how repeatable it is on them, not how it does on parcels it has never seen. What counts as right is
      what we wrote down ourselves in <code className="font-mono text-[13px]">data/demo-cases.json</code>; the orders are
      fictitious and the photos are AI-generated stand-ins. Amounts and deadlines come from code, not from the model, and the SAM
      column counts the regions it outlined, not whether the outline is right.
    </Note>
  );
}

export function EvalReport({ results, file }: { results: EvalResults; file: string }) {
  const summary = summarizeResults(results);
  const runs = summary.totalRuns;
  const cases = summary.cases.length;
  const costKnown = results.estimatedCostUsd !== null;
  return (
    <div className="flex flex-col gap-8">
      <header className="max-w-2xl">
        <Eyebrow>Evaluation</Eyebrow>
        <h1 className="mt-3 font-display text-4xl leading-[1.05] tracking-tight text-ink sm:text-5xl">How the agent holds up</h1>
        <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
          The six demo cases, each run {results.runsPerCase} {results.runsPerCase === 1 ? "time" : "times"} on {results.engineLabel},
          scored against the outcome we expected, with how much the runs varied.
        </p>
      </header>

      <Framing cases={cases} runsPerCase={results.runsPerCase} />

      <section aria-labelledby="eval-summary" className="flex flex-col gap-4">
        <h2 id="eval-summary" className="sr-only">
          Summary
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Every expectation met"
            figure={`${summary.matched.all}/${runs}`}
            caption={`runs${percent(summary.matched.all, runs)}: decision, carrier claim, human review and claim eligibility all as expected`}
          />
          <Tile
            label="Same answer every run"
            figure={results.runsPerCase > 1 ? `${summary.casesStable}/${cases}` : "n/a"}
            caption={
              results.runsPerCase > 1
                ? "cases that gave the same decision, claim and human-review answer in every run (right or wrong)"
                : "one run per case: variance cannot be measured"
            }
          />
          <Tile
            label="Median run"
            figure={seconds(summary.medianDurationMs)}
            caption="from report to finished case, including the SAM outline and the claim document"
          />
          <Tile
            label="Estimated cost"
            figure={costKnown ? `$${results.estimatedCostUsd!.toFixed(2)}` : "unknown"}
            caption={
              costKnown
                ? `for all ${runs} runs, an upper bound that bills every token at the full price: ${summary.totalTokens === null ? "no" : compact.format(summary.totalTokens)} tokens${summary.cachedTokens > 0 ? ` (${compact.format(summary.cachedTokens)} served from the provider's cache)` : ""} and ${summary.samRequests} SAM requests`
                : "the provider returned no token usage, so no cost is claimed"
            }
          />
        </div>
        <p className="text-sm text-muted">
          <span className="font-medium text-ink-soft">By expected field, over {runs} runs:</span>{" "}
          <span className="tabular">
            decision {summary.matched.decision}, carrier claim {summary.matched.carrierClaim}, human review {summary.matched.needsHuman},
            claim eligibility {summary.matched.claimEligible}
          </span>
          . {summary.completedRuns} of {runs} runs reached a decision.
        </p>
      </section>

      <section aria-labelledby="eval-cases" className="flex flex-col gap-4">
        <h2 id="eval-cases" className="text-xl font-semibold tracking-tight text-ink">
          Case by case
        </h2>
        <ol className="flex flex-col gap-4">
          {results.cases.map((c, i) => (
            <CaseCard key={c.id} result={c} summary={summary.cases[i]} index={i} />
          ))}
        </ol>
      </section>

      <Panel id="eval-reproduce" title="Reproduce it" icon={Terminal}>
        <p className="text-sm leading-relaxed text-muted">
          Needs a <code className="font-mono text-[13px]">MODEL_API_KEY</code> in <code className="font-mono text-[13px]">.env.local</code>.
          It spends real credits, refuses the demo mock, and stops before the other runs if the projected cost is over $5 (add{" "}
          <code className="font-mono text-[13px]">--yes</code> to go on).
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-ink">
          <code className="font-mono">{results.command}</code>
        </pre>
        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Engine">{results.engineLabel}</Fact>
          <Fact label="Model id">
            <span className="font-mono text-[13px]">{results.model}</span>
          </Fact>
          <Fact label="Run on">
            <span className="tabular">{formatDateTime(results.generatedAt)}</span>
          </Fact>
          <Fact label="Code">
            <span className="inline-flex items-center gap-1.5">
              <GitCommitHorizontal aria-hidden="true" className="h-4 w-4 text-muted" strokeWidth={1.75} />
              <span className="font-mono text-[13px]">{results.commit ?? "unknown commit"}</span>
              {results.dirty && <span className="text-muted">with uncommitted changes</span>}
            </span>
          </Fact>
          <Fact label="Results file">
            <span className="font-mono text-[13px]">data/eval/{file}</span>
          </Fact>
          <Fact label="Cost estimate based on">{results.pricing ? results.pricing.source : "no price for this engine"}</Fact>
        </dl>
        {summary.runsWithoutUsage > 0 && (
          <p className="mt-4 text-sm text-warning">
            {summary.runsWithoutUsage} of {runs} runs came back without token usage, so the token and cost figures undercount.
          </p>
        )}
      </Panel>
    </div>
  );
}

export function EvalEmpty() {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header>
        <Eyebrow>Evaluation</Eyebrow>
        <h1 className="mt-3 font-display text-4xl leading-[1.05] tracking-tight text-ink sm:text-5xl">How the agent holds up</h1>
        <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
          No evaluation has been committed yet. Nothing is shown here until a real one has been run: this page never
          displays an example or an estimate in its place.
        </p>
      </header>
      <pre className="overflow-x-auto rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-ink">
        <code className="font-mono">npm run eval -- --runs 3</code>
      </pre>
    </div>
  );
}
