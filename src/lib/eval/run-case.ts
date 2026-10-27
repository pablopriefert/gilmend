import path from "node:path";
import { runAgent, type AgentDeps } from "../agent/run-agent";
import { markDamage } from "../evidence/mark-damage";
import { getOrder } from "../orders";
import type { ChatParams, Provider } from "../providers";
import type { DemoCase } from "../store/demo-cases";
import { resolveDemoPhoto } from "../store/demo-photos";
import type { Engine } from "../types";
import { parseSamNote, scoreRun, sumUsage, type UsageLike } from "./score";
import type { EvalRun } from "./types";

// One run of one demo case, measured. It runs the real agent loop (runAgent) on a real provider and
// wraps two seams to count what the agent itself does not report: every model call (for tokens and
// tool calls) and every request to SAM. Nothing about the agent is changed for the measurement.

const REASONS_KEPT = 4;
const REASON_CHARS = 280;

export interface RunEvalOptions {
  demo: DemoCase;
  /** 1-based number of the run for this case. */
  run: number;
  /** The engine behind `provider`. */
  engine: Exclude<Engine, "demo-mock">;
  /** The real provider; it is wrapped here, never replaced. */
  provider: Provider;
  env: Record<string, string | undefined>;
  now?: Date;
  /** Repository root the demo photo paths are relative to. */
  root?: string;
  /** Test hooks. */
  deps?: Partial<AgentDeps>;
  fetchImpl?: typeof fetch;
}

/** Run one case once and return what was observed, scored against the case's expectation. */
export async function runEvalCase(opts: RunEvalOptions): Promise<EvalRun> {
  const { demo, run, engine, env } = opts;
  const root = opts.root ?? process.cwd();
  const now = opts.now ?? new Date();

  const usages: (UsageLike | null | undefined)[] = [];
  let modelCalls = 0;
  let toolCalls = 0;
  let samRequests = 0;

  const counting: Provider = {
    ...opts.provider,
    chat: async (params: ChatParams, options?: { timeoutMs?: number }) => {
      const completion = await opts.provider.chat(params, options);
      modelCalls++;
      toolCalls += completion.choices?.[0]?.message?.tool_calls?.length ?? 0;
      usages.push(completion.usage);
      return completion;
    },
  };

  const samFetch: typeof fetch = (input, init) => {
    samRequests++;
    return (opts.fetchImpl ?? fetch)(input, init);
  };
  const baseMark = opts.deps?.markDamage ?? markDamage;
  const deps: Partial<AgentDeps> = {
    // Always the fictitious fixture orders, whatever the environment says: an evaluation that read a
    // connected Shopify store would not be reproducible and could touch real customers' orders.
    getOrder: (number, email) => getOrder(number, email, { env: {}, now }),
    ...opts.deps,
    markDamage: (photo, options) => baseMark(photo, { ...options, fetchImpl: samFetch }),
  };

  const photos = demo.report.photos.flatMap((photo) => {
    const found = resolveDemoPhoto(photo, root);
    return found ? [path.relative(root, found)] : [];
  });

  const started = Date.now();
  let record;
  try {
    record = await runAgent(
      { ...demo.report, photos },
      { engine, provider: counting, deps, now, env, caseId: `eval_${demo.id}_${run}` },
    );
  } catch (error) {
    // runAgent promises not to throw; if it does, the run is a miss with the reason, not a crash.
    const failure = error instanceof Error ? error.message : String(error);
    return {
      run,
      completed: false,
      failure,
      decision: null,
      carrierClaim: null,
      needsHuman: null,
      claimEligible: null,
      claimAmountEur: null,
      claimDocument: false,
      confidence: null,
      guardrails: [],
      reasons: [],
      sam: { method: "none", regions: 0, concepts: [], calledByCode: false, requests: samRequests },
      durationMs: Date.now() - started,
      modelCalls,
      toolCalls,
      usage: sumUsage(usages),
      matches: scoreRun(demo.expected, { completed: false, decision: null, carrierClaim: null, needsHuman: null, claimEligible: null }),
    };
  }
  const durationMs = Date.now() - started;

  const steps = record.trace.map((t) => t.step);
  const gaveUp = steps.find((s) => s.startsWith("Agent did not reach a decision"));
  const lateError = steps.find((s) => s.startsWith("Agent error after the decision was recorded"));
  const completed = !gaveUp;
  const decision = record.decision;
  const observed = {
    completed,
    decision: decision?.decision ?? null,
    carrierClaim: decision?.carrierClaim ?? null,
    needsHuman: decision?.needsHuman ?? null,
    // No computed claim (a blurry photo never reaches compute_claim) counts as not eligible.
    claimEligible: record.claim?.eligible ?? false,
  };
  const sam = parseSamNote(record.evidence);

  return {
    run,
    failure: gaveUp ?? lateError ?? null,
    ...observed,
    claimAmountEur: record.claim?.eligible ? record.claim.maxCompensationEur : null,
    claimDocument: record.document !== null,
    confidence: decision?.confidence ?? null,
    guardrails: steps.filter((s) => s.startsWith("Guardrail: ")).map((s) => s.slice("Guardrail: ".length)),
    reasons: (decision?.reasons ?? []).slice(0, REASONS_KEPT).map((r) => r.slice(0, REASON_CHARS)),
    sam: { ...sam, calledByCode: steps.some((s) => s.startsWith("Evidence fallback:")), requests: samRequests },
    durationMs,
    modelCalls,
    toolCalls,
    usage: sumUsage(usages),
    matches: scoreRun(demo.expected, observed),
  };
}
