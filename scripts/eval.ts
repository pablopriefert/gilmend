// `npm run eval -- --runs 3`: runs the six demo cases N times each on a REAL engine and writes a
// measured, reproducible result to data/eval/<date>-<engine>.json, which the /eval page shows.
//
//   npm run eval -- [--runs 3] [--engine muse-spark-1.3] [--concurrency 1] [--cases id,id]
//                   [--max-cost 5] [--yes] [--dry-run] [--price-in USD --price-out USD]
//
// It spends real credits (about $0.04 a run on Muse Spark 1.3), so:
//  - it refuses the mock: a scripted answer scored against our expectations would measure nothing;
//  - it runs the first run alone, projects the cost of all of them from the tokens that run used,
//    and stops above --max-cost (default $5) unless --yes is given;
//  - it then keeps the money actually spent, and does not start a run that could take the total over
//    --max-cost (assuming it costs as much as the dearest run so far), unless --yes is given;
//  - runs go one after the other unless --concurrency says otherwise.
// The key comes from .env.local through `tsx --env-file` and is never printed. The agent runs on the
// fictitious fixture orders and the demo photos; nothing it generates is saved outside a throwaway
// folder (the runtime folder is redirected and the shared Blob store is switched off), and the
// results file holds counts, decisions, timings and the model's short reasons (fictitious names and
// orders only; no real customer text, no reply, no key).
//
// Only a run of every demo case that went to the end is written to data/eval/, because the /eval
// page presents that folder as "the evaluation". A run of a subset (--cases) or one stopped by the
// cost guard is written to a temporary folder instead, and its path is printed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeEngine, resolveEngine } from "../src/lib/config";
import { runEvalCase } from "../src/lib/eval/run-case";
import { evalDir } from "../src/lib/eval/results";
import {
  META_PRICING,
  costGuard,
  mayStartAnotherRun,
  runCostUsd,
  summarizeResults,
} from "../src/lib/eval/score";
import { describeEvalSettings } from "../src/lib/eval/settings";
import type { EvalPricing, EvalResults, EvalRun } from "../src/lib/eval/types";
import { getProvider } from "../src/lib/providers";
import { loadDemoCases } from "../src/lib/store/demo-cases";
import type { Engine } from "../src/lib/types";

const REAL_ENGINES = ["muse-spark-1.3", "open-weights", "openrouter"] as const;
type RealEngine = (typeof REAL_ENGINES)[number];

interface Options {
  runs: number;
  engine: RealEngine;
  concurrency: number;
  cases: string[] | null;
  maxCostUsd: number;
  yes: boolean;
  dryRun: boolean;
  priceIn: number | null;
  priceOut: number | null;
}

function usage(message?: string): never {
  if (message) console.error(`${message}\n`);
  console.error(
    "Usage: npm run eval -- [--runs 3] [--engine muse-spark-1.3|open-weights|openrouter] [--concurrency 1]\n" +
      "                       [--cases demo-1-vase-broken,demo-2-carton-crushed] [--max-cost 5] [--yes] [--dry-run]\n" +
      "                       [--price-in USD_PER_MILLION --price-out USD_PER_MILLION]   (needed for engines other than Muse Spark 1.3)",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    runs: 3,
    engine: "muse-spark-1.3",
    concurrency: 1,
    cases: null,
    maxCostUsd: 5,
    yes: false,
    dryRun: false,
    priceIn: null,
    priceOut: null,
  };
  const int = (name: string, v: string | undefined, min: number, max: number): number => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) usage(`${name} must be an integer from ${min} to ${max}.`);
    return n;
  };
  const money = (name: string, v: string | undefined): number => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) usage(`${name} must be a positive number.`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--runs": o.runs = int("--runs", next(), 1, 20); break;
      case "--concurrency": o.concurrency = int("--concurrency", next(), 1, 6); break;
      case "--engine": {
        const e = next() as RealEngine;
        if ((e as string) === "demo-mock") usage("The mock is refused: an evaluation of a scripted provider would measure nothing.");
        if (!REAL_ENGINES.includes(e)) usage(`Unknown engine "${e}".`);
        o.engine = e;
        break;
      }
      case "--cases": o.cases = (next() ?? "").split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--max-cost": o.maxCostUsd = money("--max-cost", next()); break;
      case "--price-in": o.priceIn = money("--price-in", next()); break;
      case "--price-out": o.priceOut = money("--price-out", next()); break;
      case "--yes": o.yes = true; break;
      case "--dry-run": o.dryRun = true; break;
      default: usage(`Unknown option "${arg}".`);
    }
  }
  return o;
}

function pricingFor(o: Options): EvalPricing | null {
  if (o.engine === "muse-spark-1.3" && o.priceIn === null && o.priceOut === null) return META_PRICING;
  if (o.priceIn === null || o.priceOut === null) return null;
  return {
    inputPerMillionTokensUsd: o.priceIn,
    outputPerMillionTokensUsd: o.priceOut,
    // SAM only ever runs on the Meta Model API, so only that engine pays for it.
    samPerRequestUsd: o.engine === "muse-spark-1.3" ? META_PRICING.samPerRequestUsd : 0,
    source: "set by hand with --price-in and --price-out",
  };
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** The command that reproduces the evaluation (not the cost options, which only guard the spending). */
function reproduceCommand(o: Options, allCaseIds: string[]): string {
  const parts = ["npm run eval -- --runs", String(o.runs)];
  if (o.engine !== "muse-spark-1.3") parts.push("--engine", o.engine);
  if (o.cases && o.cases.length !== allCaseIds.length) parts.push("--cases", o.cases.join(","));
  return parts.join(" ");
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const secs = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);

function describeRun(caseId: string, r: EvalRun, total: number): string {
  const observed = r.completed
    ? `${r.decision}, claim ${r.carrierClaim ? "yes" : "no"}, human ${r.needsHuman ? "yes" : "no"}`
    : `NOT FINISHED (${r.failure})`;
  const tokens = r.usage ? `${r.usage.totalTokens} tokens` : "no usage returned";
  return `[eval] ${caseId} run ${r.run}/${total}: ${observed} | ${r.matches.all ? "matches" : "MISSES"} | ${secs(r.durationMs)}, ${r.modelCalls} model calls, ${r.toolCalls} tool calls, ${tokens}`;
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  const env = process.env;
  const startedAt = new Date();

  // runAgent would quietly fall back to the labelled mock without credentials: here that would score
  // a script as if it were a model, so refuse instead.
  if (resolveEngine(o.engine as Engine, env) !== o.engine) {
    console.error(`${o.engine} is not configured (see .env.example): nothing was sent. The mock is never evaluated.`);
    process.exit(1);
  }

  const all = loadDemoCases(startedAt);
  const demos = o.cases ? all.filter((c) => o.cases!.includes(c.id)) : all;
  const unknown = (o.cases ?? []).filter((id) => !all.some((c) => c.id === id));
  if (unknown.length > 0 || demos.length === 0) {
    usage(`Unknown case(s): ${unknown.join(", ") || "(none given)"}. Known: ${all.map((c) => c.id).join(", ")}.`);
  }
  const totalRuns = demos.length * o.runs;
  const detail = describeEngine(o.engine, env);
  const pricing = pricingFor(o);
  console.log(`[eval] ${demos.length} cases x ${o.runs} runs = ${totalRuns} runs on ${detail.label}, concurrency ${o.concurrency}.`);
  if (o.dryRun) {
    console.log("[eval] --dry-run: nothing was sent.");
    return;
  }

  // Annotated photos and claim PDFs are persisted through the storage backend the environment
  // names. docs/storage.md sets DAMAGE_DESK_STORAGE=blob for a deployment, and an .env.local copied
  // from it would make every eval run upload photos and PDFs to the shared private Blob store. An
  // evaluation never needs that: force local files, which the throwaway folder below redirects
  // (27 Oct 2026, review finding: the "nothing is saved" promise only covered the runtime folder).
  if (process.env.DAMAGE_DESK_STORAGE?.trim().toLowerCase() === "blob") {
    console.log("[eval] DAMAGE_DESK_STORAGE=blob is ignored for this evaluation: local files in a throwaway folder are used.");
  }
  process.env.DAMAGE_DESK_STORAGE = "file";

  // Generated PDFs and annotated photos go to a throwaway folder, never to data/runtime/.
  const scratch = process.env.DAMAGE_DESK_RUNTIME_DIR ? null : mkdtempSync(path.join(os.tmpdir(), "gilmend-eval-"));
  if (scratch) process.env.DAMAGE_DESK_RUNTIME_DIR = scratch;

  const provider = getProvider(o.engine, env);
  // Round by round (run 1 of every case, then run 2...), so that stopping early leaves every case
  // with the same number of runs, give or take the round that was under way.
  const tasks = Array.from({ length: o.runs }, (_, i) => demos.map((demo) => ({ demo, run: i + 1 }))).flat();
  const done = new Map<string, EvalRun[]>(demos.map((d) => [d.id, []]));
  let spentUsd = 0;
  let maxRunCostUsd = 0;
  let inFlight = 0;
  let stoppedByCost = false;
  const execute = async (t: (typeof tasks)[number]) => {
    inFlight++;
    let result: EvalRun;
    try {
      result = await runEvalCase({ demo: t.demo, run: t.run, engine: o.engine, provider, env, root: process.cwd() });
    } finally {
      inFlight--;
    }
    done.get(t.demo.id)!.push(result);
    // A run whose cost is unknown is counted at the dearest run so far: unknown is not free.
    const cost = pricing ? runCostUsd(result, pricing) : null;
    maxRunCostUsd = Math.max(maxRunCostUsd, cost ?? 0);
    spentUsd += cost ?? maxRunCostUsd;
    console.log(describeRun(t.demo.id, result, o.runs));
    if (!result.matches.all) for (const reason of result.reasons) console.log(`        reason: ${reason}`);
    return result;
  };

  try {
    // The first run goes alone: its tokens are what the cost projection is made from.
    const first = await execute(tasks[0]);
    const firstCost = pricing ? runCostUsd(first, pricing) : null;
    const guard = costGuard({ firstRunCostUsd: firstCost, totalRuns, limitUsd: o.maxCostUsd, yes: o.yes });
    console.log(`[eval] ${guard.reason}`);
    if (!guard.allowed) {
      console.error("[eval] Stopped before the other runs; nothing was written.");
      process.exitCode = 2;
      return;
    }

    const queue = tasks.slice(1);
    const worker = async () => {
      while (queue.length > 0) {
        // The projection came from one run; this checks what has really been spent before each
        // further run, and stops the whole queue at the first refusal.
        if (stoppedByCost || !mayStartAnotherRun({ spentUsd, maxRunCostUsd, inFlight, limitUsd: o.maxCostUsd, yes: o.yes })) {
          if (!stoppedByCost) {
            stoppedByCost = true;
            console.error(
              `[eval] Stopping: $${spentUsd.toFixed(2)} spent, and the next run could cost up to $${maxRunCostUsd.toFixed(2)}, which would pass the $${o.maxCostUsd.toFixed(2)} limit. Re-run with --yes to go on.`,
            );
          }
          return;
        }
        await execute(queue.shift()!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(o.concurrency, Math.max(queue.length, 1)) }, worker));
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }

  const cases = demos
    .map((d) => ({
      id: d.id,
      title: d.title,
      expected: {
        decision: d.expected.decision,
        acceptableDecisions: d.expected.acceptableDecisions,
        carrierClaim: d.expected.carrierClaim,
        needsHuman: d.expected.needsHuman,
        claimEligible: d.expected.claimEligible,
      },
      runs: done.get(d.id)!.sort((a, b) => a.run - b.run),
    }))
    // A stopped evaluation may not have reached every case.
    .filter((c) => c.runs.length > 0);
  const allRuns = cases.flatMap((c) => c.runs);
  const costs = allRuns.map((r) => (pricing ? runCostUsd(r, pricing) : null));
  const results: EvalResults = {
    schemaVersion: 1,
    generatedAt: startedAt.toISOString(),
    engine: o.engine,
    model: detail.model,
    engineLabel: detail.label,
    runsPerCase: o.runs,
    command: reproduceCommand(o, all.map((c) => c.id)),
    commit: git(["rev-parse", "--short", "HEAD"]),
    // The results file itself is committed afterwards, so it must not make the tree "dirty".
    dirty: (git(["status", "--porcelain", "--", ".", ":!data/eval"]) ?? "").length > 0,
    pricing,
    settings: describeEvalSettings(o.engine, env),
    estimatedCostUsd: costs.length > 0 && costs.every((c): c is number => c !== null) ? costs.reduce((a, b) => a + b, 0) : null,
    cases,
  };

  // Only a complete evaluation of every demo case belongs in data/eval (see the header).
  const complete = !stoppedByCost && demos.length === all.length;
  const dir = complete ? evalDir() : mkdtempSync(path.join(os.tmpdir(), "gilmend-eval-out-"));
  const stem = `${startedAt.toISOString().slice(0, 10)}-${o.engine}`;
  let file = path.join(dir, `${stem}.json`);
  for (let n = 2; existsSync(file); n++) file = path.join(dir, `${stem}-${n}.json`);
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`, { flag: "wx" });

  printSummary(results);
  if (complete) {
    console.log(`\n[eval] written: ${path.relative(process.cwd(), file)}`);
  } else {
    console.log(
      `\n[eval] ${stoppedByCost ? "Stopped by the cost guard" : "Only some of the demo cases were run"}: the result is NOT in data/eval ` +
        `(the /eval page shows a complete evaluation only). Written to ${file}`,
    );
    if (stoppedByCost) process.exitCode = 2;
  }
}

function printSummary(results: EvalResults): void {
  const s = summarizeResults(results);
  console.log("\ncase                           expected               observed (runs)                match  claim kept  median");
  for (const c of s.cases) {
    const expected = `${c.expected.decision}${c.expected.carrierClaim ? "+claim" : ""}${c.expected.needsHuman ? "+human" : ""}`;
    const observed = Object.entries(c.decisionCounts).map(([d, n]) => `${d} x${n}`).join(", ") || "none";
    console.log(
      `${pad(c.id, 30)} ${pad(expected, 22)} ${pad(observed, 31)} ${pad(`${c.matched.all}/${c.runs}`, 6)} ${pad(`${c.carrierClaimCount}/${c.runs}`, 11)} ${secs(c.medianDurationMs)}`,
    );
  }
  console.log(
    `\nAll expected fields met in ${s.matched.all}/${s.totalRuns} runs (decision ${s.matched.decision}, carrier claim ${s.matched.carrierClaim}, ` +
      `human review ${s.matched.needsHuman}, claim eligibility ${s.matched.claimEligible}); ${s.casesStable}/${s.cases.length} cases gave the same answer every run; ` +
      `${s.completedRuns}/${s.totalRuns} runs finished.`,
  );
  console.log(
    `Median ${secs(s.medianDurationMs)} a run, ${s.totalTokens ?? "unknown"} tokens, ${s.samRequests} SAM requests, ` +
      `estimated cost ${results.estimatedCostUsd === null ? "unknown" : `$${results.estimatedCostUsd.toFixed(2)}`} ` +
      `(estimate at the published starting price, cache discounts ignored).`,
  );
}

main().catch((err) => {
  console.error("eval failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
