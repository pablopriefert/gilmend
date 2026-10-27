import type { OrderSummary, StreamEvent, ToolResult } from "@/lib/agent/events";
import type { DecisionKind, Engine } from "@/lib/types";
import { CARRIER_LABEL, DAMAGE_TYPE_LABEL, DECISION_LABEL, SEVERITY_LABEL, formatEur } from "../format";

// The state of the live timeline (27 Oct 2026), a pure reduction of the events the server
// streamed. The page never invents a step: every row below comes from one event, and the time
// next to it is the server's own clock (`t`, ms since the run started), not the time the browser
// received it, so a slow network does not make a fast step look slow.

export type StepState = "running" | "done" | "failed";

export interface LiveStep {
  id: string;
  kind: "intake" | "thinking" | "tool" | "guardrail" | "notice";
  /** Wire id of the tool, for a tool row. */
  tool?: string;
  /** Model turn, for a thinking row. */
  turn?: number;
  calledBy?: "model" | "code";
  label: string;
  /** What the step found, once it ended. */
  detail?: string;
  state: StepState;
  /** Server clock when the step began (ms since the run started). */
  atMs: number;
  /** How long it took (ms), once it ended. */
  ms?: number;
  /** A guardrail or a notice: drawn as a warning, never as plain progress. */
  warning?: boolean;
}

export interface LiveOutline {
  path: string;
  regions: number;
  concepts: string[];
  photoIndex: number;
  /** Server clock when the outline was ready. */
  atMs: number;
}

export interface LiveClaim {
  eligible: boolean;
  maxCompensationEur: number;
  claimDeadline: string | null;
  daysLeft: number | null;
}

export interface LiveDecision {
  decision: DecisionKind;
  confidence: number;
  needsHuman: boolean;
  carrierClaim: boolean;
}

export interface LiveRunState {
  /**
   * sending: the report is going up, nothing heard yet. running: events are coming in.
   * done: the case is saved. error: the server said it failed. lost: the stream ended without
   * either (the connection dropped); the run itself may well have finished and been saved.
   */
  phase: "sending" | "running" | "done" | "error" | "lost";
  engine: Engine | null;
  /** Full name of what runs, from run_started. */
  label: string | null;
  /** True when the model is the scripted mock (DEMO MODE). */
  mock: boolean;
  caseId: string | null;
  steps: LiveStep[];
  order: OrderSummary | null;
  /** get_order ran and found nothing. */
  orderMissing: boolean;
  outline: LiveOutline | null;
  claim: LiveClaim | null;
  decision: LiveDecision | null;
  /** Server clock of the last event (ms since the run started): the total once phase is done. */
  lastMs: number;
  error: string | null;
}

export function initialLiveRun(): LiveRunState {
  return {
    phase: "sending",
    engine: null,
    label: null,
    mock: false,
    caseId: null,
    steps: [{ id: "s0", kind: "intake", label: "Sending the report", state: "running", atMs: 0 }],
    order: null,
    orderMissing: false,
    outline: null,
    claim: null,
    decision: null,
    lastMs: 0,
    error: null,
  };
}

// ---- wording ---------------------------------------------------------------------------

/** Who the model is, in a sentence: the page never calls the scripted mock "the model". */
export function actorName(engine: Engine | null): string {
  switch (engine) {
    case "demo-mock":
      return "The scripted mock";
    case "muse-spark-1.3":
      return "Muse";
    case "open-weights":
      return "The open-weights model";
    case "openrouter":
      return "The model";
    default:
      return "The agent";
  }
}

/** What a model turn is doing, said with the right subject (the mock reads no image and says so). */
export function thinkingLabel(engine: Engine | null, turn: number, phase: "running" | "done"): string {
  const actor = actorName(engine);
  if (engine === "demo-mock") {
    if (turn === 1) return phase === "running" ? `${actor} starts its script (it reads no image)` : `${actor} started its script (it read no image)`;
    return phase === "running" ? `${actor} picks the next step` : `${actor} picked the next step`;
  }
  if (turn === 1) return phase === "running" ? `${actor} is reading the report and the photos` : `${actor} read the report and the photos`;
  return phase === "running" ? `${actor} is deciding the next step` : `${actor} decided the next step`;
}

export const TOOL_TITLE: Record<string, string> = {
  get_order: "Looking up the order",
  assess_photos: "Reading the damage on the photos",
  mark_damage: "Outlining with SAM 3.1",
  get_carrier_rules: "Checking the carrier's rules",
  compute_claim: "Computing the claim",
  finish_case: "Recording the decision and the reply",
  draft_claim_document: "Drafting the claim PDF and the carrier e-mail",
};

export function toolTitle(tool: string): string {
  return TOOL_TITLE[tool] ?? "Running a tool";
}

/** "+4.2 s": the server's clock. Under a tenth of a second it still says +0.0 s: it is a real reading. */
export function formatOffset(ms: number): string {
  return `+${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

export function formatDuration(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/** What a finished tool found, in one line. Everything comes from the event, nothing is guessed. */
export function describeResult(result: ToolResult, calledBy: "model" | "code" = "model"): string {
  switch (result.tool) {
    case "get_order": {
      if (!result.found || !result.order) return "No order matches this number and e-mail.";
      return `Order ${result.order.orderId} found, shipped by ${CARRIER_LABEL[result.order.carrier] ?? result.order.carrier}.`;
    }
    case "assess_photos": {
      const quality = result.photoQuality === "ok" ? "" : `, photos ${result.photoQuality}`;
      return `${result.item || "Item"}: ${DAMAGE_TYPE_LABEL[result.damageType].toLowerCase()}, ${SEVERITY_LABEL[result.severity].toLowerCase()}${quality}.`;
    }
    case "mark_damage": {
      const by = calledBy === "code" ? "Called by the code, not the model. " : "";
      if (result.method !== "sam-3.1" || result.regions === 0) {
        return `${by}No outline: the claim keeps the raw photo. ${result.note}`.trim();
      }
      const concepts = result.concepts.length > 0 ? ` for ${result.concepts.map((c) => `“${c}”`).join(", ")}` : "";
      return `${by}${plural(result.regions, "region")} outlined on photo ${result.photoIndex + 1}${concepts}. What SAM matched, not a damage verdict.`;
    }
    case "get_carrier_rules":
      return `${result.label} terms loaded (dated public sources).`;
    case "compute_claim": {
      if (!result.eligible) return "Not eligible for a carrier claim (worked out by code).";
      const left = result.daysLeft === null ? "" : `, ${plural(Math.max(0, result.daysLeft), "day")} left to claim`;
      return `Eligible: up to ${formatEur(result.maxCompensationEur)}${left}. Worked out by code, not by the model.`;
    }
    case "finish_case":
      return `${DECISION_LABEL[result.decision]}, confidence ${Math.round(result.confidence * 100)}%${result.needsHuman ? ", needs a human" : ""}.`;
    case "draft_claim_document":
      return "Claim PDF and carrier e-mail ready for your review.";
  }
}

// ---- the reduction ---------------------------------------------------------------------

/** Index of the last row that satisfies `match`, or -1. */
function lastIndex(steps: LiveStep[], match: (s: LiveStep) => boolean): number {
  for (let i = steps.length - 1; i >= 0; i--) if (match(steps[i])) return i;
  return -1;
}

function replaceAt(steps: LiveStep[], index: number, patch: Partial<LiveStep>): LiveStep[] {
  return steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

function push(steps: LiveStep[], step: Omit<LiveStep, "id">): LiveStep[] {
  return [...steps, { ...step, id: `s${steps.length}` }];
}

/** Close any row still spinning (the stream ended, or the case is done): none may spin forever. */
function settle(steps: LiveStep[], state: StepState): LiveStep[] {
  return steps.map((s) => (s.state === "running" ? { ...s, state } : s));
}

export function reduceLiveRun(state: LiveRunState, event: StreamEvent): LiveRunState {
  if (event.type === "ping") return state;
  const next: LiveRunState = { ...state, lastMs: Math.max(state.lastMs, event.t) };

  switch (event.type) {
    case "accepted": {
      const mock = event.engine === "demo-mock";
      return {
        ...next,
        phase: "running",
        engine: event.engine,
        mock,
        caseId: event.caseId,
        steps: replaceAt(state.steps, 0, {
          label: "Report received and stored",
          detail: "The case exists from now on: it is kept even if you close this page.",
          state: "done",
          ms: event.t,
        }),
      };
    }

    case "run_started":
      return { ...next, phase: "running", engine: event.engine, label: event.label, mock: event.mock };

    case "thinking": {
      if (event.phase === "start") {
        return {
          ...next,
          steps: push(state.steps, {
            kind: "thinking",
            turn: event.turn,
            label: thinkingLabel(state.engine, event.turn, "running"),
            state: "running",
            atMs: event.t,
          }),
        };
      }
      const at = lastIndex(state.steps, (s) => s.kind === "thinking" && s.turn === event.turn && s.state === "running");
      if (at < 0) return next;
      return {
        ...next,
        steps: replaceAt(state.steps, at, {
          state: event.ok ? "done" : "failed",
          label: event.ok ? thinkingLabel(state.engine, event.turn, "done") : state.steps[at].label,
          ms: event.ms,
          detail: event.ok ? undefined : "The model call failed.",
        }),
      };
    }

    case "tool_start":
      return {
        ...next,
        steps: push(state.steps, {
          kind: "tool",
          tool: event.tool,
          calledBy: event.calledBy,
          label: toolTitle(event.tool),
          state: "running",
          atMs: event.t,
        }),
      };

    case "tool_end": {
      const at = lastIndex(
        state.steps,
        (s) => s.kind === "tool" && s.tool === event.tool && s.calledBy === event.calledBy && s.state === "running",
      );
      const detail = event.ok
        ? event.result
          ? describeResult(event.result, event.calledBy)
          : undefined
        : (event.error ?? "The step failed.");
      const patch: Partial<LiveStep> = { state: event.ok ? "done" : "failed", ms: event.ms, detail };
      const steps =
        at >= 0
          ? replaceAt(state.steps, at, patch)
          : push(state.steps, {
              kind: "tool",
              tool: event.tool,
              calledBy: event.calledBy,
              label: toolTitle(event.tool),
              atMs: Math.max(0, event.t - event.ms),
              state: "done",
              ...patch,
            });
      return { ...applyResult(next, event.result, event.t), steps };
    }

    case "guardrail":
      return {
        ...next,
        steps: push(state.steps, {
          kind: "guardrail",
          label: "Guardrail",
          detail: event.message,
          state: "done",
          atMs: event.t,
          warning: true,
        }),
      };

    case "notice":
      return {
        ...next,
        steps: push(state.steps, {
          kind: "notice",
          label: event.code === "photos_withheld" ? "Photos not read by the model" : "Heads up",
          detail: event.message,
          state: "done",
          atMs: event.t,
          warning: true,
        }),
      };

    case "run_finished":
      return {
        ...next,
        decision: {
          decision: event.decision,
          confidence: event.confidence,
          needsHuman: event.needsHuman,
          carrierClaim: event.carrierClaim,
        },
      };

    case "done":
      return { ...next, phase: "done", caseId: event.caseId, engine: event.engine, steps: settle(state.steps, "done") };

    case "error":
      return {
        ...next,
        phase: "error",
        caseId: event.caseId ?? state.caseId,
        error: event.message,
        steps: settle(state.steps, "failed"),
      };
  }
}

/** The stream ended without `done` or `error`: say so, and stop every spinner. */
export function loseLiveRun(state: LiveRunState): LiveRunState {
  if (state.phase === "done" || state.phase === "error") return state;
  return { ...state, phase: "lost", steps: settle(state.steps, "failed") };
}

function applyResult(state: LiveRunState, result: ToolResult | null, t: number): LiveRunState {
  if (!result) return state;
  switch (result.tool) {
    case "get_order":
      return { ...state, order: result.found ? result.order : state.order, orderMissing: !result.found };
    case "mark_damage":
      // The first outline stays on screen; a later photo's does not replace it.
      return result.annotatedPath && !state.outline
        ? {
            ...state,
            outline: {
              path: result.annotatedPath,
              regions: result.regions,
              concepts: result.concepts,
              photoIndex: result.photoIndex,
              atMs: t,
            },
          }
        : state;
    case "compute_claim":
      return {
        ...state,
        claim: {
          eligible: result.eligible,
          maxCompensationEur: result.maxCompensationEur,
          claimDeadline: result.claimDeadline,
          daysLeft: result.daysLeft,
        },
      };
    default:
      return state;
  }
}
