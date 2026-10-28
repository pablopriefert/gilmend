import type { Env } from "../config";
import { describeEngine, resolveEngine } from "../config";
import { getProvider, type Provider } from "../providers";
import { listCases } from "../store/cases";
import type { CaseRecord, Engine } from "../types";
import { realRunsPerDay, takeRealRun } from "../../app/api/_lib/rate-limit";
import { parisDay } from "./format";
import { buildSweepPlan, sweepSettings } from "./plan";
import { loadLatestSweep, saveLatestSweep } from "./store";
import {
  BRIEFING_SYSTEM,
  NUDGE_SYSTEM,
  REFUSAL_NOTE,
  acceptModelText,
  askModel,
  briefingFacts,
  inputKey,
  nudgeFacts,
  templateBriefing,
  templateNudge,
  type ModelAnswer,
} from "./text";
import type { SweepItem, SweepPlan, SweepResult, SweepText } from "./types";

// The morning sweep, end to end (29 Oct 2026): read the cases, compute the plan in code, ask the
// engine to write the briefing and the nudges, store the result.
//
// Cost, bounded on purpose:
//  - one model call for the briefing, plus one per nudge, at most SWEEP_MAX_NUDGES of them: a sweep
//    never makes more than SWEEP_MAX_MODEL_CALLS (6) calls, each a short text with no image;
//  - a sweep that needs at least one call takes ONE slot of the daily ceiling on real runs (the one
//    POST /api/reports counts on), and past the ceiling it writes with the labelled demo script;
//  - texts are cached for the (Paris) day: the same facts for the same engine reuse today's text,
//    so "Run the sweep now" twice in a row costs one sweep, and a sweep with no change costs none.

export const SWEEP_MAX_NUDGES = 5;
export const SWEEP_MAX_MODEL_CALLS = 1 + SWEEP_MAX_NUDGES;

export interface SweepStore {
  load(): Promise<SweepResult | null>;
  save(sweep: SweepResult): Promise<void>;
}

export interface RunSweepOptions {
  trigger: "manual" | "cron";
  /** Read the committed recorded runs too, each as of its recording day. Default false. */
  includeRecorded?: boolean;
  now?: Date;
  env?: Env;
  /** Tests and scripts: the cases to sweep, instead of the store's. */
  cases?: CaseRecord[];
  /** Tests and scripts: the provider to write with, instead of the one the environment builds. */
  provider?: Provider;
  /** Tests: where the latest sweep is kept. Default: the real store (files or Blob). */
  store?: SweepStore;
}

export interface RunSweepOutcome {
  sweep: SweepResult;
  /** False when the sweep ran but could not be stored (it is still returned). */
  stored: boolean;
}

function demoText(text: string, key: string): SweepText {
  return { text, source: "demo-mock", inputKey: key };
}

function templateText(text: string, key: string, note: string): SweepText {
  return { text, source: "template", note, inputKey: key };
}

function errorLine(err: unknown): string {
  // Status and message only: an API error never carries a key, but a stack could carry paths.
  const status = (err as { status?: unknown })?.status;
  return `${typeof status === "number" ? `HTTP ${status}: ` : ""}${err instanceof Error ? err.message.slice(0, 160) : "unknown error"}`;
}

export async function runSweep(options: RunSweepOptions): Promise<RunSweepOutcome> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const store: SweepStore = options.store ?? { load: () => loadLatestSweep(env), save: (s) => saveLatestSweep(s, env) };
  const includeRecorded = options.includeRecorded === true;

  const cases = options.cases ?? (await listCases());
  const settings = sweepSettings(env);
  const plan: SweepPlan = buildSweepPlan(cases, now, { includeRecorded, ...settings });
  const day = parisDay(now);

  // --- which engine writes -------------------------------------------------------------
  let provider: Provider | null = null;
  let engine: Engine = options.provider ? options.provider.engine : resolveEngine("muse-spark-1.3", env);
  let fellBackReason: SweepResult["fellBackReason"] = !options.provider && engine === "demo-mock" ? "no_credentials" : null;
  if (engine !== "demo-mock") {
    try {
      provider = options.provider ?? getProvider(engine, env);
    } catch (err) {
      console.error("[gilmend] sweep: the engine could not be built:", errorLine(err));
      engine = "demo-mock";
      fellBackReason = "no_credentials";
    }
  }
  const writerId = () => (provider && !provider.isMock ? provider.model : "demo-mock");

  // --- what today's earlier sweep already wrote ------------------------------------------
  let previous: SweepResult | null = null;
  try {
    previous = await store.load();
  } catch (err) {
    console.error("[gilmend] sweep: could not read the previous sweep:", errorLine(err));
  }
  const reusable = new Map<string, SweepText>();
  if (previous && previous.day === day) {
    // Only what a model wrote: a template or a demo script costs nothing to write again.
    if (previous.briefing.source === "model") reusable.set(previous.briefing.inputKey, previous.briefing);
    for (const item of previous.items) {
      if (item.nudge?.source === "model") reusable.set(item.nudge.inputKey, item.nudge);
    }
  }

  // --- the jobs ------------------------------------------------------------------------
  interface Job {
    kind: "briefing" | "nudge";
    system: string;
    facts: string;
    key: string;
    /** Template that stands in when the model is not used or its text is refused. */
    fallback: () => string;
    /** Index in plan.items for a nudge. */
    index?: number;
    reused?: SweepText;
  }
  const jobs: Job[] = [];
  const keyFor = (kind: "briefing" | "nudge", facts: string) => inputKey(engine === "demo-mock" ? "demo-mock" : writerId(), kind, facts);

  const briefingJobFacts = briefingFacts(plan, now);
  const briefing: Job = {
    kind: "briefing",
    system: BRIEFING_SYSTEM,
    facts: briefingJobFacts,
    key: keyFor("briefing", briefingJobFacts),
    fallback: () => templateBriefing(plan, now),
  };
  // Nothing due: there is nothing to write about, so no call (and no slot of the daily ceiling).
  const nothingDue = plan.items.length === 0;
  if (!nothingDue) jobs.push(briefing);

  const items: SweepItem[] = plan.items.map((i) => ({ ...i }));
  const privateNudges: number[] = [];
  const overCap: number[] = [];
  let withModel = 0;
  items.forEach((item, index) => {
    if (item.action !== "nudge_customer") return;
    if (item.caseEngine === "open-weights") {
      // A case run privately never has its data sent to the Meta Model API: its nudge is a template.
      privateNudges.push(index);
      return;
    }
    if (withModel >= SWEEP_MAX_NUDGES) {
      overCap.push(index);
      return;
    }
    withModel += 1;
    const facts = nudgeFacts(item);
    jobs.push({
      kind: "nudge",
      system: NUDGE_SYSTEM,
      facts,
      key: keyFor("nudge", facts),
      fallback: () => templateNudge(item).text,
      index,
    });
  });

  // --- reuse, then the daily slot -------------------------------------------------------
  const real = engine !== "demo-mock";
  if (real) for (const job of jobs) job.reused = reusable.get(job.key);
  const toAsk = real ? jobs.filter((j) => !j.reused) : [];
  let askModelNow = real && toAsk.length > 0;
  if (askModelNow && !takeRealRun(realRunsPerDay(env), now.getTime())) {
    askModelNow = false;
    // Whatever was reused stays real; the rest is written by the labelled script. The sweep says
    // it fell back when it had to (the briefing is the headline of the screen).
    fellBackReason = "daily_limit";
    if (!briefing.reused && !nothingDue) engine = "demo-mock";
  }

  // --- writing ---------------------------------------------------------------------------
  const written = new Map<Job, SweepText>();
  const modelCalls = { briefing: 0, nudges: 0 };
  const usage = { promptTokens: 0, completionTokens: 0, any: false };
  let reusedTexts = 0;

  await Promise.all(
    jobs.map(async (job) => {
      if (job.reused) {
        reusedTexts += 1;
        written.set(job, job.reused);
        return;
      }
      if (!askModelNow || !provider) {
        // The labelled demo script (no key, or the daily ceiling was reached).
        written.set(job, demoText(job.fallback(), job.key));
        return;
      }
      if (job.kind === "briefing") modelCalls.briefing += 1;
      else modelCalls.nudges += 1;
      let answer: ModelAnswer;
      try {
        answer = await askModel(provider, job.system, job.facts);
      } catch (err) {
        console.error(`[gilmend] sweep: the ${job.kind} call failed:`, errorLine(err));
        written.set(job, templateText(job.fallback(), job.key, "the model call failed, so a template stands in"));
        return;
      }
      if (answer.usage) {
        usage.promptTokens += answer.usage.promptTokens;
        usage.completionTokens += answer.usage.completionTokens;
        usage.any = true;
      }
      const accepted = acceptModelText(answer.text, job.facts, job.kind);
      if (accepted.ok) {
        written.set(job, { text: accepted.text, source: "model", model: provider.model, inputKey: job.key });
      } else {
        written.set(
          job,
          templateText(job.fallback(), job.key, `${REFUSAL_NOTE[accepted.reason]}, so a template stands in`),
        );
      }
    }),
  );

  // --- put the texts on the plan ----------------------------------------------------------
  for (const job of jobs) {
    if (job.kind === "nudge" && job.index !== undefined) items[job.index].nudge = written.get(job) ?? null;
  }
  const nudgeKey = (item: SweepItem) => inputKey("template", "nudge", nudgeFacts(item));
  for (const index of privateNudges) {
    const item = items[index];
    const t = templateNudge(item);
    items[index].nudge = templateText(t.text, nudgeKey(item), "this case ran privately, so its data is not sent to the Meta Model API: a template is used");
  }
  for (const index of overCap) {
    const item = items[index];
    const t = templateNudge(item);
    items[index].nudge = templateText(t.text, nudgeKey(item), `only ${SWEEP_MAX_NUDGES} nudges are written by the model per sweep: a template is used`);
  }
  // A template is English or French: say so when the customer's language is another one.
  for (const item of items) {
    if (item.nudge?.source !== "model" && item.nudge && item.language !== "en" && item.language !== "fr") {
      item.nudge = { ...item.nudge, note: `${item.nudge.note ? `${item.nudge.note}; ` : ""}written in English: no template for this customer's language` };
    }
  }

  const briefingText: SweepText = nothingDue
    ? templateText(templateBriefing(plan, now), briefing.key, "nothing is due, so no model was needed")
    : (written.get(briefing) as SweepText);

  const sweep: SweepResult = {
    ...plan,
    items,
    version: 1,
    generatedAt: now.toISOString(),
    day,
    trigger: options.trigger,
    engine,
    engineDetail: engine === "demo-mock" ? describeEngine("demo-mock", env) : (provider?.detail ?? describeEngine(engine, env)),
    fellBackReason,
    briefing: briefingText,
    modelCalls: {
      briefing: modelCalls.briefing,
      nudges: modelCalls.nudges,
      total: modelCalls.briefing + modelCalls.nudges,
      cap: SWEEP_MAX_MODEL_CALLS,
    },
    reusedTexts,
    nudgesOverCap: overCap.length,
    usage: usage.any ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens } : null,
  };

  let stored = true;
  try {
    await store.save(sweep);
  } catch (err) {
    stored = false;
    console.error("[gilmend] sweep: could not store the result:", errorLine(err));
  }
  return { sweep, stored };
}

// A sweep that is running on this instance is shared with a second request for the same thing (a
// double click, the cron landing on a click): one set of model calls, one answer for both.
const inflight = new Map<string, Promise<RunSweepOutcome>>();

export function runSweepOnce(options: RunSweepOptions): Promise<RunSweepOutcome> {
  const key = options.includeRecorded === true ? "recorded" : "live";
  const running = inflight.get(key);
  if (running) return running;
  const started = runSweep(options).finally(() => inflight.delete(key));
  inflight.set(key, started);
  return started;
}
