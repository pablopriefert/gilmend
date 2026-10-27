import { randomUUID } from "node:crypto";
import type {
  ChatCompletionContentPart,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { describeEngine, resolveEngine, type Env } from "../config";
import { buildClaimDocument } from "../documents/claim-pdf";
import { damageConceptsFor, markDamage } from "../evidence/mark-damage";
import {
  DEFAULT_INTEGRITY_DEPS,
  checkPhotoIntegrity,
  integrityForModel,
  type IntegrityCache,
  type IntegrityInput,
} from "../integrity/check";
import { getOrder } from "../orders";
import { getProvider, type Provider } from "../providers";
import { allPhotos, caseRound, followUpsOf, snapshotRound, workingReport } from "../rounds";
import { computeClaim, getCarrierRules } from "../rules/carriers";
import { listCases } from "../store/cases";
import type {
  CarrierId,
  CaseRecord,
  ClaimComputation,
  ClaimDocument,
  DamageAssessment,
  DamageReport,
  DamageType,
  Decision,
  Engine,
  Evidence,
  FollowUp,
  Order,
  PhotoIntegrity,
  TraceStep,
} from "../types";
import { formatFollowUpMessage, type NotAttachedPhotos } from "./follow-up-prompt";
import {
  scrub,
  summarizeIntegrity,
  summarizeMarkDamage,
  summarizeOrder,
  type AgentEventInput,
  type AgentEventSink,
  type ToolResult,
} from "./events";
import { applyGuardrails, describeGuardrailNote } from "./guardrails";
import { photoToImageUrl } from "./photos";
import { redactForTrace } from "./redact";
import { formatReportMessage } from "./report-prompt";
import { SYSTEM_PROMPT } from "./system-prompt";
import {
  AGENT_TOOLS,
  TRACE_TOOL_NAME,
  parseAssessment,
  parseCarrier,
  parseConcept,
  parseDecision,
  parseToolArguments,
  type ModelToolName,
} from "./tools";

/** Rejects when `work` takes longer than `ms` (the timer is cleared as soon as it settles). */
class TimeoutError extends Error {}

async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  if (!Number.isFinite(ms)) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Damage types whose evidence SAM can outline (the item, its pieces or the box). */
const EVIDENCE_DAMAGE_TYPES: readonly DamageType[] = ["broken_product", "crushed_packaging", "opened_parcel"];

/**
 * Maximum number of model turns (a turn may contain several parallel tool calls). 9 since
 * check_photo_integrity became a tool (27 Oct 2026): the first real run of Muse Spark 1.3 with it
 * used all 8 turns of the old cap, one tool per turn, which left no turn to spare before finish_case.
 */
export const MAX_AGENT_STEPS = 9;

/**
 * Wall-clock budget of a real run (ms). The route is capped by the platform (maxDuration on
 * Vercel): a slow model must end in a "needs a human" case that carries the trace, not in a
 * function killed before anything was saved. The mock is instant and has no budget.
 */
export const DEFAULT_TIME_BUDGET_MS = 90_000;
/** One model call never waits longer than this, nor longer than what is left of the budget. */
const MODEL_CALL_TIMEOUT_MS = 45_000;
const MIN_MODEL_CALL_TIMEOUT_MS = 5_000;
/**
 * The evidence fallback needs at least this much of the budget left. It can make up to 3 SAM calls
 * (markDamage's own cap), and a SAM call waits 30 s by default: started at 89 s of 90 it could run to
 * about 180 s, past the route's maxDuration of 120 (review of 27 Oct 2026). Below this margin the claim
 * ships with the raw photo, which is the honest default when SAM finds nothing anyway.
 */
const MIN_EVIDENCE_FALLBACK_MS = 20_000;
/** Number of SAM calls the fallback may make: the remaining time is shared between them. */
const EVIDENCE_FALLBACK_SAM_CALLS = 3;
const MIN_SAM_CALL_TIMEOUT_MS = 5_000;
/**
 * The integrity check (it reads every stored case) never waits longer than what is left of the time
 * budget, but at least this long: it is plain code and usually takes well under a second, and the
 * guardrails need its answer. A timeout is a tool error, so the case goes to a human (review of
 * 27 Oct 2026: nothing bounded it, and finish_case runs it after the loop's last budget check).
 */
export const MIN_INTEGRITY_TIMEOUT_MS = 5_000;

/**
 * Most images one request of a resumed run carries (review of 28 Oct 2026). Every round used to send
 * every photo of every earlier round: with MAX_FOLLOW_UPS = 3 the fourth request held up to 12 images of
 * up to 10 MB each, which nobody had checked the Meta API accepts, and a refusal silently turned the case
 * into one whose photos were "not read". The report's photos and the photos of the reply being processed
 * always go first; the photos of the replies in between are described in words ("not attached").
 */
export const MAX_IMAGES_ON_RESUME = 6;

/** The collaborators of the loop. Injectable so tests never touch disk, network or other lots. */
export interface AgentDeps {
  getOrder: typeof getOrder;
  markDamage: typeof markDamage;
  getCarrierRules: typeof getCarrierRules;
  computeClaim: typeof computeClaim;
  buildClaimDocument: typeof buildClaimDocument;
  /** Photo integrity checks (src/lib/integrity): reads the photos and the stored cases. */
  checkPhotoIntegrity: (input: IntegrityInput) => Promise<PhotoIntegrity>;
}

export interface RunAgentOptions {
  engine: Engine;
  /**
   * resumeAgent only: produce the next round under this NEW case id instead of the id of `previous`,
   * and mark the result `followedFrom` the id of `previous`. Used for a recorded showcase run, whose
   * stored copy would otherwise hide the recording for every visitor (review of 28 Oct 2026).
   */
  forkAs?: string;
  /** Test hook: use this provider instead of getProvider(). */
  provider?: Provider;
  deps?: Partial<AgentDeps>;
  /** "Now" for deadline maths (injected so results are reproducible). */
  now?: Date;
  maxSteps?: number;
  env?: Env;
  /** Id of the case to produce (the route saves a "new" case under it before the run). */
  caseId?: string;
  /** Wall-clock budget in ms; defaults to DEFAULT_TIME_BUDGET_MS for real engines, none for the mock. */
  timeBudgetMs?: number;
  /**
   * Live progress (see ./events): called as each thing really happens, never with the key, a photo
   * or the customer's words. Whatever it throws is ignored: watching the run must never break it.
   */
  onEvent?: AgentEventSink;
}

const DEFAULT_DEPS: AgentDeps = {
  getOrder: (...a) => getOrder(...a),
  markDamage: (...a) => markDamage(...a),
  getCarrierRules: (...a) => getCarrierRules(...a),
  computeClaim: (...a) => computeClaim(...a),
  buildClaimDocument: (...a) => buildClaimDocument(...a),
  checkPhotoIntegrity: (input) => checkPhotoIntegrity(input, { listCases: () => listCases(), ...DEFAULT_INTEGRITY_DEPS }),
};

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const sameOrderNumber = (a: string, b: string): boolean =>
  a.replace(/[#\s]/g, "").toLowerCase() === b.replace(/[#\s]/g, "").toLowerCase();

/** The case a follow-up round resumes, and what the customer sent (see resumeAgent). */
interface Resume {
  previous: CaseRecord;
  followUp: FollowUp;
  /** Round being run: 2 for the first reply. */
  round: number;
  /** Photos that were in the case before this reply: the new ones start at this index. */
  firstNewPhoto: number;
  /** Set when the round is saved as a NEW case that starts from `previous` (a recorded run is never changed). */
  followedFrom: string | null;
}

/**
 * Run the tool-calling agent on one customer report and return the resulting case
 * (status 'needs_review': nothing is sent anywhere, the merchant approves later).
 * The case is NOT saved here; the caller stores it (saveCase).
 *
 * This function never throws for model, tool or provider problems: they end up in
 * `trace` and the case goes to the merchant with needsHuman=true, so the UI never crashes.
 */
export async function runAgent(report: DamageReport, opts: RunAgentOptions): Promise<CaseRecord> {
  return runCase(report, opts, null);
}

/**
 * Resume a case after the customer replied (the follow-up loop, 28 Oct 2026): the same agent, the
 * same tools, the same guardrails, on the SAME case, with the full context of what happened before.
 *
 *  - the model sees the original report and its photos, then a follow-up block: what it concluded
 *    last time, the reply the customer was sent, their new message (as untrusted data) and the new
 *    photos (follow-up-prompt.ts);
 *  - the order found earlier is reused, so the delivery date the deadlines count from is the one
 *    the case already had (a correction of the order number looks it up again);
 *  - deadlines are computed by computeClaim exactly as in round 1: from the delivery date of the
 *    order and the report's original date, never from the date of the reply;
 *  - the trace keeps everything before it and continues with a "Round n" marker; every new step
 *    carries `round`; the outcome of the round it replaces is kept in `previousRounds`;
 *  - the engine is the one the caller passes (the route reuses the engine of the case: a private
 *    run stays private, a mock stays a labelled mock).
 *
 * Returns the whole case, status 'needs_review', NOT saved (the caller stores it). Like runAgent it
 * never throws for model, tool or provider problems.
 */
export async function resumeAgent(
  previous: CaseRecord,
  followUp: FollowUp,
  opts: RunAgentOptions,
): Promise<CaseRecord> {
  const firstNewPhoto = allPhotos(previous).length;
  return runCase(workingReport(previous, followUp), { ...opts, caseId: opts.forkAs ?? previous.id }, {
    previous,
    followUp,
    round: caseRound(previous) + 1,
    firstNewPhoto,
    followedFrom: opts.forkAs ? previous.id : null,
  });
}

/**
 * Which photos of the working report go to the model, and which ones are only described. A round 1
 * run sends them all (a report holds at most 3). A resumed run sends at most MAX_IMAGES_ON_RESUME: the
 * new photos first, then the earlier ones in the order they came (the report's photos, then each
 * reply's), so what is left out is always the most recent of the in-between replies.
 */
function planImages(report: DamageReport, resume: Resume | null): { send: number[]; notAttached: NotAttachedPhotos[] } {
  const all = report.photos.map((_, i) => i);
  if (!resume || all.length <= MAX_IMAGES_ON_RESUME) return { send: all, notAttached: [] };
  const fresh = all.filter((i) => i >= resume.firstNewPhoto);
  const earlier = all.filter((i) => i < resume.firstNewPhoto);
  const room = Math.max(0, MAX_IMAGES_ON_RESUME - fresh.length);
  const dropped = earlier.slice(room);
  const notAttached: NotAttachedPhotos[] = [];
  // Each group is one round's photos: round 1 is the report, round k + 2 is reply k.
  let start = 0;
  const sizes = [resume.previous.report.photos.length, ...followUpsOf(resume.previous).map((f) => f.photos.length)];
  sizes.forEach((size, k) => {
    const inGroup = dropped.filter((i) => i >= start && i < start + size);
    if (inGroup.length > 0) notAttached.push({ round: k + 1, first: inGroup[0], last: inGroup[inGroup.length - 1] });
    start += size;
  });
  return { send: [...earlier.slice(0, room), ...fresh], notAttached };
}

async function runCase(report: DamageReport, opts: RunAgentOptions, resume: Resume | null): Promise<CaseRecord> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const maxSteps = opts.maxSteps ?? MAX_AGENT_STEPS;
  const deps: AgentDeps = { ...DEFAULT_DEPS, ...opts.deps };
  const round = resume?.round ?? 1;
  const createdAt = resume ? resume.previous.createdAt : new Date().toISOString();
  const startedAt = Date.now();
  const emit = (event: AgentEventInput) => {
    if (!opts.onEvent) return;
    try {
      opts.onEvent({ ...event, t: Date.now() - startedAt } as Parameters<AgentEventSink>[0]);
    } catch {
      // A broken listener (a closed stream, a bug in the page) must not take the agent down.
    }
  };

  // A follow-up continues the trace of the case: earlier rounds stay as they were written.
  const trace: TraceStep[] = resume ? [...resume.previous.trace] : [];
  const log = (step: string, extra: Omit<TraceStep, "step" | "at"> = {}) => {
    trace.push({
      step,
      ...(extra.tool ? { tool: extra.tool } : {}),
      ...(extra.input !== undefined ? { input: redactForTrace(extra.input) } : {}),
      ...(extra.output !== undefined ? { output: redactForTrace(extra.output) } : {}),
      at: new Date().toISOString(),
      ...(resume ? { round } : {}),
    });
  };
  if (resume) {
    const sent = [
      resume.followUp.message.trim() ? "a message" : null,
      resume.followUp.photos.length > 0
        ? `${resume.followUp.photos.length} new photo${resume.followUp.photos.length === 1 ? "" : "s"}`
        : null,
      resume.followUp.orderNumber?.trim() ? "a corrected order number" : null,
    ].filter(Boolean);
    log(
      `Round ${round} starts: the customer replied (${sent.join(", ") || "nothing readable"}). The agent resumes this same case with what it concluded in round ${round - 1}.`,
      { input: { followUpId: resume.followUp.id, round } },
    );
    if (resume.followedFrom) {
      log(
        `This case continues the recorded run ${resume.followedFrom}, which is left untouched: round ${round - 1} of this case is a copy of it.`,
      );
    }
  }

  // Engine selection. Without credentials the engine silently becomes the mock; that is
  // allowed only because the case, the trace and the UI all say so.
  let provider: Provider | null = opts.provider ?? null;
  const engine: Engine = provider ? provider.engine : resolveEngine(opts.engine, env);
  if (engine === "demo-mock") {
    const why =
      !provider && opts.engine !== "demo-mock"
        ? ` (requested "${opts.engine}" but its credentials are missing)`
        : "";
    log(
      `DEMO MODE: scripted mock provider${why}. This answer does NOT come from Muse and no image was analysed.`,
    );
  } else {
    // For open weights `engine` alone does not say which model and host run: the detail does.
    log(`Engine: ${engine} (${(provider?.detail ?? describeEngine(engine, env)).label})`);
  }

  // State of the investigation, filled by the tools.
  // `null as T | null` stops TypeScript narrowing these to `null`: the tool closures
  // below assign them, which its flow analysis does not see from the loop.
  let order = null as Order | null;
  let assessment = null as DamageAssessment | null;
  let claim = null as ClaimComputation | null;
  let decision = null as Decision | null;
  let document = null as ClaimDocument | null;
  let integrity = null as PhotoIntegrity | null;
  // Delivery date the last integrity check compared the capture dates with: when the model calls
  // the tool before get_order the date is unknown, and the check is run again once it is.
  let integrityDeliveredAt = null as string | null;
  const integrityCache: IntegrityCache = {};
  // A check that timed out is not started again (each try could wait the whole timeout): the case
  // goes to a human through the tool error it already counted.
  let integrityTimedOut = false;
  const caseId = opts.caseId ?? `case_${randomUUID()}`;
  const budgetMs = opts.timeBudgetMs ?? (engine === "demo-mock" ? Infinity : DEFAULT_TIME_BUDGET_MS);
  // A follow-up keeps the evidence of the photos already in the case: they are still in the case.
  const evidence: Evidence[] = resume ? [...resume.previous.evidence] : [];
  const toolErrors: string[] = [];
  const toolOutputs: unknown[] = [];
  let failure: string | null = null;
  // True when the model was not shown the photos (its server cannot read images, or refused
  // them). Then nothing it says about damage comes from the photos, and the case goes to a human.
  let photosNotRead = false;
  // Evidence fallback (see ensureEvidence): done at most once, and never on a photo the model
  // already asked SAM about with the assessment in hand (same concepts, same answer, a wasted call).
  let evidenceFallbackDone = false;
  const markedWithAssessment = new Set<number>();
  // What the last mark_damage did, for the live events (set where the tool runs, read once it ends).
  let lastMark: ToolResult | null = null;
  // The model turn being waited on, for the live events: closed exactly once, on every way out.
  let openTurn = null as { turn: number; startedAt: number } | null;
  const closeTurn = (ok: boolean, toolCalls = 0) => {
    if (!openTurn) return;
    const { turn, startedAt: since } = openTurn;
    openTurn = null;
    emit({ type: "thinking", turn, phase: "end", ok, toolCalls, ms: Date.now() - since });
  };

  const snapshot = (): CaseRecord => ({
    id: caseId,
    // The case keeps the ORIGINAL report; the working report (with the new photos) is only for the loop.
    report: resume ? resume.previous.report : report,
    order,
    assessment,
    claim,
    decision,
    evidence: [...evidence],
    document,
    status: "needs_review",
    engine,
    engineDetail: provider?.detail ?? describeEngine(engine, env),
    ...(integrity ? { integrity } : {}),
    trace: [...trace],
    createdAt,
    updatedAt: new Date().toISOString(),
    // `recorded` is deliberately not carried over: the case is no longer the recording (round 1 keeps it).
    ...(resume
      ? {
          followUps: [...followUpsOf(resume.previous), resume.followUp],
          previousRounds: [...(resume.previous.previousRounds ?? []), snapshotRound(resume.previous)],
          ...(resume.followedFrom ? { followedFrom: resume.followedFrom } : {}),
        }
      : {}),
  });

  const toolError = (name: string, message: string) => {
    toolErrors.push(name);
    return { error: message };
  };

  // ---- tools -----------------------------------------------------------------------

  async function runTool(name: string, rawArgs: unknown): Promise<unknown> {
    const parsed = parseToolArguments(rawArgs);
    if (!parsed.ok) return { error: parsed.error };
    const args = parsed.value;

    switch (name as ModelToolName) {
      case "get_order": {
        // The e-mail is always the report's, never a model argument: one customer must
        // not be able to read another customer's order, even through prompt injection.
        const number =
          typeof args.orderNumber === "string" && args.orderNumber.trim()
            ? args.orderNumber.trim()
            : report.orderNumber;
        // A follow-up reuses the order found earlier (same delivery date, so the deadlines do not drift
        // with the date of the reply) unless the customer corrected the order number.
        const earlier = resume && !resume.followUp.orderNumber?.trim() ? resume.previous.order : null;
        if (earlier && sameOrderNumber(number, earlier.id)) {
          order = earlier;
          const out = { found: true, order: earlier, note: `Order found in round ${round - 1}, reused.` };
          toolOutputs.push(out);
          return out;
        }
        try {
          const found = await deps.getOrder(number, report.customerEmail);
          order = found;
          const out = found
            ? { found: true, order: found }
            : { found: false, message: "No order matches this number and e-mail." };
          toolOutputs.push(out);
          return out;
        } catch (e) {
          return toolError("get_order", `order lookup failed: ${errMessage(e)}`);
        }
      }

      case "check_photo_integrity": {
        try {
          const out = integrityForModel(await runIntegrity("model"));
          // Deterministic code output, like the carrier rules: the dates in it may be quoted.
          toolOutputs.push(out);
          return out;
        } catch (e) {
          return toolError("check_photo_integrity", `photo integrity check failed: ${errMessage(e)}`);
        }
      }

      case "assess_photos": {
        if (photosNotRead) {
          // Not recorded: a reading written without seeing the photos would end up, as evidence,
          // in the PDF that goes to the carrier.
          return {
            error:
              "You were not shown the photos, so there is no reading to record. Do not guess: call finish_case with needsHuman=true.",
          };
        }
        const a = parseAssessment(args);
        if (!a.ok) return { error: a.error };
        assessment = a.value;
        // Deliberately NOT added to toolOutputs: it is the model's own words, and the
        // guardrail that checks amounts and dates against tool results must not treat what
        // the model wrote as proof of itself.
        return { recorded: true, assessment: a.value };
      }

      case "mark_damage": {
        const idx = args.photoIndex;
        if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= report.photos.length) {
          return { error: `photoIndex must be an integer between 0 and ${report.photos.length - 1}` };
        }
        const photo = report.photos[idx];
        // What SAM outlines starts from what the model names, but the evidence must not hang on
        // that one word ("ceramic vase" found 1 region, "broken pottery" 26 on the same photo,
        // 27 Oct 2026): damageConceptsFor adds a "broken <material>" or the item noun from the
        // recorded assessment, markDamage asks them together and merges the regions, and the
        // packaging is asked only when nothing about the item matched.
        const concept = parseConcept(args.concept);
        const { concepts, fallbackConcepts } = damageConceptsFor(concept, assessment);
        if (assessment) markedWithAssessment.add(idx);
        let ev: Evidence;
        try {
          // `engine` decides whether SAM may run at all: not for a private run, not in demo mode.
          ev = await deps.markDamage(photo, { engine, concepts, fallbackConcepts });
        } catch (e) {
          // markDamage should never throw; if it does the claim still ships with the raw photo.
          ev = { photo, annotatedPhoto: null, method: "none", note: `mark_damage failed: ${errMessage(e)}` };
        }
        const at = evidence.findIndex((x) => x.photo === photo);
        if (at >= 0) evidence[at] = ev;
        else evidence.push(ev);
        lastMark = safeMarkResult(idx, [...concepts, ...(ev.method === "sam-3.1" ? [] : fallbackConcepts)], ev);
        // Never send the image back to the model: only whether the outline worked.
        return {
          photoIndex: idx,
          annotated: ev.annotatedPhoto !== null,
          method: ev.method,
          note: ev.note,
          ...(args.concept !== undefined && concept === null
            ? { conceptIgnored: "concept must be 1 to 4 lowercase words (a noun phrase); the concepts from the recorded assessment (and the packaging as a last resort) were used" }
            : {}),
        };
      }

      case "get_carrier_rules": {
        const carrier = parseCarrier(args.carrier);
        if (!carrier.ok) return { error: carrier.error };
        try {
          const rules = deps.getCarrierRules(carrier.value);
          toolOutputs.push(rules);
          return rules;
        } catch (e) {
          return toolError("get_carrier_rules", `carrier rules failed: ${errMessage(e)}`);
        }
      }

      case "compute_claim": {
        if (photosNotRead) {
          // Same lock as assess_photos: compute_claim also accepts an inline assessment, and one
          // written without the photos would show on screen as "what the agent saw" and feed a claim.
          // Checked before args.assessment is read: neither `assessment` nor `claim` may change.
          return {
            error:
              "You were not shown the photos, so there is no reading to compute a claim from. Do not guess: call finish_case with needsHuman=true.",
          };
        }
        if (!order) {
          return { error: "No order is loaded. Call get_order first; if it found nothing, finish_case with needsHuman=true." };
        }
        if (args.assessment !== undefined) {
          const a = parseAssessment(args.assessment);
          if (!a.ok) return { error: a.error };
          assessment = a.value;
        }
        if (!assessment) {
          return { error: "No assessment is recorded. Call assess_photos first (your reading of the photos)." };
        }
        // Mondial Relay only pays when the recipient refused the parcel. The flag is the
        // customer's word (null = not said): the model transcribes it, it does not decide it.
        const refused =
          typeof args.parcelRefusedAtDelivery === "boolean" ? args.parcelRefusedAtDelivery : null;
        try {
          // Deadlines are computed from the report's own timestamp and our clock: the
          // model supplies neither.
          claim = deps.computeClaim(order, assessment, report.receivedAt, now, {
            parcelRefusedAtDelivery: refused,
          });
          toolOutputs.push(claim);
          return claim;
        } catch (e) {
          return toolError("compute_claim", `claim computation failed: ${errMessage(e)}`);
        }
      }

      case "finish_case": {
        if (decision) return { error: "finish_case was already called; the decision is recorded." };
        const d = parseDecision(args);
        if (!d.ok) return { error: d.error };
        await ensureIntegrity();
        const result = applyGuardrails(d.value, {
          order,
          quotedOrderNumber: report.orderNumber,
          assessment,
          claim,
          toolErrors,
          toolOutputs,
          reportReceivedAt: report.receivedAt,
          photosNotRead,
          integrity,
          photosMissing: photosNotRead || engine === "demo-mock" ? 0 : unread.length,
          round,
        });
        decision = result.decision;
        for (const adj of result.adjustments) log(`Guardrail: ${adj}`);
        // The trace keeps the internal wording; the person watching the timeline gets a plain sentence
        // (review of 28 Oct 2026: "needsHuman forced: ..." is code talk in an otherwise English list).
        for (const note of result.notes) emit({ type: "guardrail", message: scrub(describeGuardrailNote(note), 240) });
        const needsDoc = decision.carrierClaim && !document;
        return {
          accepted: true,
          decision,
          guardrailAdjustments: result.adjustments,
          next: needsDoc ? "Call draft_claim_document, then stop." : "Done. Stop calling tools.",
        };
      }

      case "draft_claim_document": {
        if (!decision) return { error: "Call finish_case first." };
        if (!decision.carrierClaim || !order || !claim?.eligible) {
          return { error: "No carrier claim to file for this case." };
        }
        return await draftDocument();
      }

      default:
        return { error: `Unknown tool "${name}". Available: ${AGENT_TOOLS.map((t) => t.function.name).join(", ")}.` };
    }
  }

  /** Runs the integrity checks with what the run knows now (the delivery date of the order, once found). */
  async function runIntegrity(calledBy: "model" | "code"): Promise<PhotoIntegrity> {
    const deliveredAt = order?.deliveredAt ?? null;
    const timeoutMs = Math.max(MIN_INTEGRITY_TIMEOUT_MS, budgetMs - (Date.now() - startedAt));
    if (integrityTimedOut) throw new Error("photo integrity check already timed out in this run");
    let result: PhotoIntegrity;
    try {
      result = await withTimeout(
        deps.checkPhotoIntegrity({
          report,
          caseId,
          deliveredAt,
          calledBy,
          now,
          cache: integrityCache,
          // A follow-up checks every photo of the case, but reads only the new ones: the hashes and
          // capture dates of the earlier rounds are on the case already. When the round is saved as
          // a NEW case (a recorded run), the case it continues is not "another case".
          ...(resume
            ? {
                knownPhotos: resume.previous.integrity?.photos.filter((p) => p.index < resume.firstNewPhoto) ?? [],
                ...(resume.followedFrom ? { ignoreCaseIds: [resume.followedFrom] } : {}),
              }
            : {}),
        }),
        timeoutMs,
        "photo integrity check",
      );
    } catch (e) {
      if (e instanceof TimeoutError) integrityTimedOut = true;
      throw e;
    }
    integrity = result;
    integrityDeliveredAt = deliveredAt;
    return result;
  }

  /**
   * The photo integrity check must have run before the guardrails: the model is asked to call it,
   * but a guardrail cannot depend on a model remembering to. When the model skipped it, or called it
   * before the order (so without a delivery date to compare), the code runs it and says so in the
   * trace. A failure counts as a tool error, which sends the case to a human.
   */
  async function ensureIntegrity(runEnded = false): Promise<void> {
    const deliveredAt = order?.deliveredAt ?? null;
    if (integrity && integrityDeliveredAt === deliveredAt) return;
    const why = integrity
      ? "the order was found after the model's check, so the capture dates are compared with its delivery date now"
      : runEnded
        ? "the run ended before the model finished, and the case must still carry the photo hashes"
        : "the model did not call check_photo_integrity";
    // The live timeline shows the code's own call as one, so the person watching sees the check ran
    // even though the model did not ask for it (turn 0: it belongs to no model turn).
    const toolStart = Date.now();
    emit({ type: "tool_start", tool: "check_photo_integrity", turn: 0, calledBy: "code" });
    try {
      const result = await runIntegrity("code");
      emit({
        type: "tool_end",
        tool: "check_photo_integrity",
        turn: 0,
        calledBy: "code",
        ok: true,
        ms: Date.now() - toolStart,
        result: safeResult("check_photo_integrity", null),
      });
      log(`Photo integrity check run by the code (${why}).`, {
        tool: TRACE_TOOL_NAME.check_photo_integrity,
        output: integrityForModel(result),
      });
      toolOutputs.push(integrityForModel(result));
    } catch (e) {
      toolErrors.push("check_photo_integrity");
      emit({
        type: "tool_end",
        tool: "check_photo_integrity",
        turn: 0,
        calledBy: "code",
        ok: false,
        ms: Date.now() - toolStart,
        result: null,
        error: scrub(errMessage(e), 160),
      });
      log(`Tool error: photo integrity check failed (${errMessage(e)}).`, { tool: TRACE_TOOL_NAME.check_photo_integrity });
    }
  }

  /**
   * mark_damage is optional for the model, and on 27 Oct 2026 Muse skipped it on the crushed-carton
   * case, so that case had no evidence at all. When the assessment shows something SAM can outline
   * (a broken product, a crushed or an opened parcel) on photos that are readable, and nothing was
   * outlined, the code asks SAM once, on the first photo, for the concepts the assessment implies,
   * and says in the trace that the code did it, not the model. One photo and markDamage's own cap of
   * 3 SAM calls bound the cost. Only on the Meta Model API: a private, demo or OpenRouter run never
   * calls SAM (markDamage refuses them too, this is the first gate). Called before a claim document
   * is built, so the outline goes into the PDF, and once more after the loop for cases without one.
   */
  async function ensureEvidence(): Promise<void> {
    if (evidenceFallbackDone) return;
    evidenceFallbackDone = true;
    if (engine !== "muse-spark-1.3" || photosNotRead || !assessment) return;
    if (assessment.photoQuality !== "ok" || !EVIDENCE_DAMAGE_TYPES.includes(assessment.damageType)) return;
    // In a follow-up the photo to outline is the first NEW one (the earlier ones were judged before),
    // and an outline of an earlier photo does not count as this round's evidence. A reply with no new
    // photo has nothing to outline.
    const target = resume ? resume.firstNewPhoto : 0;
    const roundPhotos = new Set(report.photos.slice(target));
    if (target >= report.photos.length) return;
    if (evidence.some((e) => e.method === "sam-3.1" && roundPhotos.has(e.photo))) return;
    if (markedWithAssessment.has(target)) return;
    // Not just "is there budget left": enough of it for the SAM calls, each of which gets an equal
    // share of what remains (see MIN_EVIDENCE_FALLBACK_MS). Infinity (the mock) never reaches here.
    const remainingMs = budgetMs - (Date.now() - startedAt);
    if (remainingMs < MIN_EVIDENCE_FALLBACK_MS) return;
    const timeoutMs = Math.max(MIN_SAM_CALL_TIMEOUT_MS, Math.floor(remainingMs / EVIDENCE_FALLBACK_SAM_CALLS));

    const { concepts, fallbackConcepts } = damageConceptsFor(null, assessment);
    const toolStart = Date.now();
    emit({ type: "tool_start", tool: "mark_damage", turn: 0, calledBy: "code" });
    let ev: Evidence;
    try {
      ev = await deps.markDamage(report.photos[target], { engine, concepts, fallbackConcepts, timeoutMs });
    } catch (e) {
      ev = { photo: report.photos[target], annotatedPhoto: null, method: "none", note: `mark_damage failed: ${errMessage(e)}` };
    }
    const at = evidence.findIndex((x) => x.photo === ev.photo);
    if (at >= 0) evidence[at] = ev;
    else evidence.push(ev);
    emit({
      type: "tool_end",
      tool: "mark_damage",
      turn: 0,
      calledBy: "code",
      ok: true,
      ms: Date.now() - toolStart,
      result: safeMarkResult(0, [...concepts, ...(ev.method === "sam-3.1" ? [] : fallbackConcepts)], ev),
    });
    log(
      `Evidence fallback: the model did not outline any photo, so the code (not the model) called mark_damage once on photo ${target + 1}, for the concepts of the recorded assessment (${assessment.damageType.replace(/_/g, " ")}).`,
      {
        tool: TRACE_TOOL_NAME.mark_damage,
        input: { photoIndex: target, concepts, fallbackConcepts, calledBy: "code" },
        output: { annotated: ev.annotatedPhoto !== null, method: ev.method, note: ev.note },
      },
    );
  }

  async function draftDocument(): Promise<unknown> {
    await ensureEvidence();
    try {
      const doc = await deps.buildClaimDocument(snapshot());
      document = doc;
      return { ok: true, pdfPath: doc.pdfPath, emailSubject: doc.emailSubject };
    } catch (e) {
      // The case still goes to the merchant, who files by hand: say so, do not hide it.
      if (decision) {
        decision = {
          ...decision,
          needsHuman: true,
          reasons: [...decision.reasons, `Guardrail: the claim document could not be generated (${errMessage(e)}).`],
        };
        emit({ type: "guardrail", message: `The claim document could not be generated (${scrub(errMessage(e), 120)}).` });
      }
      return toolError("draft_claim_document", `claim document failed: ${errMessage(e)}`);
    }
  }

  /** Same rule for the outline's summary, which is built inside the tools themselves. */
  function safeMarkResult(photoIndex: number, concepts: readonly string[], ev: Evidence): ToolResult | null {
    try {
      return summarizeMarkDamage(photoIndex, concepts, ev);
    } catch {
      return null;
    }
  }

  /** Building an event must never cost the run: a result that cannot be summarised is simply not sent. */
  function safeResult(name: string, output: unknown): ToolResult | null {
    try {
      return resultFor(name, output);
    } catch {
      return null;
    }
  }

  /** The structured result of a tool that succeeded, for the live events: read from the state it just set. */
  function resultFor(name: string, output: unknown): ToolResult | null {
    switch (name as ModelToolName) {
      case "get_order": {
        const found = (output as { found?: unknown } | null)?.found === true;
        return { tool: "get_order", found, order: found && order ? summarizeOrder(order) : null };
      }
      case "check_photo_integrity":
        return integrity ? summarizeIntegrity(integrity) : null;
      case "assess_photos":
        return assessment
          ? {
              tool: "assess_photos",
              item: scrub(assessment.item, 80),
              damageType: assessment.damageType,
              severity: assessment.severity,
              photoQuality: assessment.photoQuality,
            }
          : null;
      case "mark_damage":
        return lastMark;
      case "get_carrier_rules": {
        const rules = output as { carrier?: CarrierId; label?: string } | null;
        return rules?.carrier ? { tool: "get_carrier_rules", carrier: rules.carrier, label: scrub(rules.label, 60) } : null;
      }
      case "compute_claim":
        return claim
          ? {
              tool: "compute_claim",
              eligible: claim.eligible,
              maxCompensationEur: claim.maxCompensationEur,
              claimDeadline: claim.claimDeadline,
              daysLeft: claim.daysLeft,
            }
          : null;
      case "finish_case":
        return decision
          ? {
              tool: "finish_case",
              decision: decision.decision,
              confidence: decision.confidence,
              needsHuman: decision.needsHuman,
              carrierClaim: decision.carrierClaim,
            }
          : null;
      case "draft_claim_document":
        return document ? { tool: "draft_claim_document", ok: true } : null;
      default:
        return null;
    }
  }

  // ---- provider ---------------------------------------------------------------------

  if (!provider) {
    try {
      provider = getProvider(engine, env);
    } catch (e) {
      failure = `provider unavailable: ${errMessage(e)}`;
    }
  }

  // ---- opening message (text + photos) ---------------------------------------------

  // In a follow-up the user turn holds the original report with its photos, then the follow-up
  // block with the new ones. `originalCount` splits the photos of `report` between the two.
  const originalCount = resume ? resume.firstNewPhoto : report.photos.length;
  const plan = planImages(report, resume);
  const attached: number[] = [];
  // Photos the model was meant to see and that could not be read (see the missing-photos note below).
  const unread: { index: number; why: string }[] = [];
  const imageParts = new Map<number, ChatCompletionContentPart>();
  // The note that tells the model some photos of the case are missing from what it sees. Empty when
  // everything was attached, and when the photos are withheld altogether (that note says it all).
  let missingNote = "";
  // The text of the turn, for the photos attached so far (none at all when they are withheld).
  const compose = (): ChatCompletionContentPart[] => {
    const early = attached.filter((i) => i < originalCount);
    const late = attached.filter((i) => i >= originalCount);
    const parts: ChatCompletionContentPart[] = [
      { type: "text", text: formatReportMessage(report, early) },
      ...early.map((i) => imageParts.get(i)!),
    ];
    if (resume) {
      parts.push(
        { type: "text", text: formatFollowUpMessage(resume.previous, resume.followUp, round, late, plan.notAttached) },
        ...late.map((i) => imageParts.get(i)!),
      );
    }
    if (missingNote && !photosNotRead) parts.push({ type: "text", text: missingNote });
    return parts;
  };
  // One array, edited in place: `messages` below holds it, and the retry without photos must reach it.
  const content: ChatCompletionContentPart[] = [];

  /**
   * Tell the model, and the trace, that it will not see the photos. Used when the engine's model
   * cannot read images and when its server refused them: in both cases the run goes on (the report
   * text, the order and the carrier rules are still useful) but never pretends to have read them.
   */
  const withholdPhotos = (why: string) => {
    photosNotRead = true;
    attached.length = 0;
    content.splice(0, content.length, ...compose(), {
      type: "text",
      text: `System note: the customer's photos were NOT shown to you (${why}). You cannot judge the damage from them. Do not guess what they show, do not call assess_photos or compute_claim: call finish_case with needsHuman=true and say in the reasons that the photos were not read by the model.`,
    });
    log(
      `The photos were NOT read by the model (${why}). Nothing in this case comes from looking at them: it goes to a human.`,
    );
    emit({
      type: "notice",
      code: "photos_withheld",
      message: `The photos were not read by the model (${scrub(why, 120)}). Nothing in this case comes from looking at them: it goes to a human.`,
    });
  };

  if (provider && provider.supportsImages === false && report.photos.length > 0) {
    withholdPhotos(`${provider.model} is configured without image input`);
  } else {
    for (const i of plan.send) {
      try {
        const url = await photoToImageUrl(report.photos[i]);
        imageParts.set(i, { type: "image_url", image_url: { url } });
        attached.push(i);
      } catch (e) {
        unread.push({ index: i, why: errMessage(e) });
        log(`Photo ${i} could not be read and was not sent to the model: ${errMessage(e)}`);
        emit({ type: "notice", code: "photo_unreadable", message: `Photo ${i + 1} could not be read and was not sent to the model.` });
      }
    }
    // The scripted mock never looks at an image and says so everywhere ("no image was analysed"): a missing
    // file changes nothing about what it can say, and the six demo cases carry legacy ".jpg" paths that
    // only the demo-photo lookup resolves. The rules below are for the engines that DO read the photos.
    const readsPhotos = engine !== "demo-mock";
    if (readsPhotos && report.photos.length > 0 && attached.length === 0) {
      // Nothing to look at (every file is missing from this instance and from the shared store, or
      // unreadable): the model must not be left to judge damage it was never shown, with a block that
      // says "compare with the photos above" and no photo above (review of 28 Oct 2026).
      withholdPhotos(`none of the ${report.photos.length} photo(s) of this case could be read from storage (${unread[0]?.why ?? "no reason given"})`);
    } else {
      if (readsPhotos && unread.length > 0) {
        const list = unread.map((u) => u.index).join(", ");
        missingNote = `System note: ${unread.length} photo(s) of this case (index ${list} in photo_index) could NOT be loaded and are not attached. You cannot rule out that they show something the other photos do not, and you cannot compare the new photos with them. Do not say you compared them: call finish_case with needsHuman=true and say in the reasons which photos you could not see.`;
        log(
          `${unread.length} photo(s) of this case could not be loaded (index ${list}). The model was told, and the case goes to a human.`,
        );
      }
      content.push(...compose());
    }
  }
  const leftOut = report.photos.length - plan.send.length;
  log(
    resume
      ? `Follow-up received (${attached.filter((i) => i >= originalCount).length} new photo(s), ${attached.length} photo(s) attached in total${leftOut > 0 ? `, ${leftOut} earlier photo(s) described in words but not attached, to keep the request small` : ""})`
      : `Report received (${attached.length} photo(s) attached)`,
    { input: { orderNumber: report.orderNumber, language: report.language } },
  );

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content },
  ];

  // Announced once the opening message is built, not before: only now is it known how many photos the
  // model is really shown (none for a text-only model, fewer when one could not be read), and the page
  // words "reading the photos" from that count (review of 28 Oct 2026). Any photo notice above therefore
  // comes before this event; the page orders nothing by it.
  emit({
    type: "run_started",
    engine,
    model: provider?.model ?? "none",
    label: (provider?.detail ?? describeEngine(engine, env)).label,
    mock: engine === "demo-mock",
    photos: report.photos.length,
    photosSent: attached.length,
  });

  // ---- the loop ---------------------------------------------------------------------

  let nudged = false;
  for (let step = 1; provider && step <= maxSteps; step++) {
    const remainingMs = budgetMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      failure = `the time budget of ${Math.round(budgetMs / 1000)} s ran out before step ${step}`;
      break;
    }
    let completion;
    openTurn = { turn: step, startedAt: Date.now() };
    emit({ type: "thinking", turn: step, phase: "start" });
    const callModel = () =>
      provider!.chat(
        { messages, tools: AGENT_TOOLS },
        {
          timeoutMs: Math.max(MIN_MODEL_CALL_TIMEOUT_MS, Math.min(MODEL_CALL_TIMEOUT_MS, remainingMs)),
        },
      );
    try {
      completion = await callModel();
    } catch (e) {
      // A server that rejects the very first request while photos are attached may simply not
      // take images (a text-only deployment, a size limit). Retry once without them, out loud;
      // if it still fails, the failure below is the real one.
      const status = (e as { status?: unknown })?.status;
      if (step === 1 && attached.length > 0 && (status === 400 || status === 413 || status === 415 || status === 422)) {
        withholdPhotos(`the server answered HTTP ${status} to the request with photos: ${errMessage(e)}`);
        try {
          completion = await callModel();
        } catch (e2) {
          failure = `model call failed at step ${step}: ${errMessage(e2)}`;
          closeTurn(false);
          break;
        }
      } else {
        failure = `model call failed at step ${step}: ${errMessage(e)}`;
        closeTurn(false);
        break;
      }
    }
    const message = completion.choices?.[0]?.message;
    if (!message) {
      failure = `model returned no message at step ${step}`;
      closeTurn(false);
      break;
    }
    const calls = (message.tool_calls ?? []).filter(
      (c): c is ChatCompletionMessageFunctionToolCall => c.type === "function",
    );
    closeTurn(true, calls.length);
    if (message.content?.trim()) log(`Model note (step ${step})`, { output: message.content.trim() });

    // The assistant turn must be replayed with its tool_calls, and each call answered
    // below, otherwise strict servers (Meta's API included) reject the next request.
    messages.push({
      role: "assistant",
      content: message.content ?? null,
      ...(calls.length > 0 ? { tool_calls: calls } : {}),
    });

    if (calls.length === 0) {
      if (decision) break;
      if (!nudged) {
        nudged = true;
        log("Model answered without calling finish_case; asked it to finish");
        messages.push({
          role: "user",
          content: "You must record your decision by calling finish_case (needsHuman=true if unsure). Do not answer in plain text.",
        });
        continue;
      }
      failure = "model never called finish_case";
      break;
    }

    for (const call of calls) {
      const name = call.function.name;
      const known = AGENT_TOOLS.some((t) => t.function.name === name);
      // A tool must never take the run down: whatever it throws becomes a tool error the
      // model sees, counted so the guardrails send the case to a human.
      let output: unknown;
      lastMark = null;
      // An unknown name is the model's own text: it is not sent.
      const wireName = known ? name : "unknown";
      const toolStart = Date.now();
      emit({ type: "tool_start", tool: wireName, turn: step, calledBy: "model" });
      try {
        output = await runTool(name, call.function.arguments);
      } catch (e) {
        output = toolError(name, `tool "${name}" crashed: ${errMessage(e)}`);
      }
      const isError = typeof output === "object" && output !== null && "error" in output;
      emit({
        type: "tool_end",
        tool: wireName,
        turn: step,
        calledBy: "model",
        ok: !isError,
        ms: Date.now() - toolStart,
        result: isError || !known ? null : safeResult(name, output),
        ...(isError ? { error: scrub((output as { error?: unknown }).error, 160) } : {}),
      });
      log(`${isError ? "Tool error" : "Tool"}: ${name}`, {
        ...(known ? { tool: TRACE_TOOL_NAME[name as ModelToolName] } : {}),
        input: call.function.arguments,
        output,
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
    }

    if (decision && (!decision.carrierClaim || document)) break;
  }

  // ---- wrap up ----------------------------------------------------------------------

  // A run that ends without finish_case (model failure, time budget, step cap) never reached the
  // guardrail that runs the check. It is plain code and needs no model: run it so that every saved
  // case carries its hashes and a later report reusing the photo is caught (review of 27 Oct 2026).
  // The fallback decision below already sends the case to a human.
  if (!integrity && !toolErrors.includes("check_photo_integrity")) await ensureIntegrity(true);
  await ensureEvidence();

  // The model decided a claim is due but never drafted it (step limit, or it stopped):
  // draft it ourselves, the document is deterministic and the merchant expects it.
  if (decision?.carrierClaim && !document && order && claim?.eligible) {
    log("Claim document not drafted by the model; generating it");
    const toolStart = Date.now();
    emit({ type: "tool_start", tool: "draft_claim_document", turn: 0, calledBy: "code" });
    const out = await draftDocument();
    const drafted = !(typeof out === "object" && out !== null && "error" in out);
    emit({
      type: "tool_end",
      tool: "draft_claim_document",
      turn: 0,
      calledBy: "code",
      ok: drafted,
      ms: Date.now() - toolStart,
      result: drafted ? { tool: "draft_claim_document", ok: true } : null,
      ...(drafted ? {} : { error: scrub((out as { error?: unknown }).error, 160) }),
    });
    log("Tool: draft_claim_document (automatic)", { tool: TRACE_TOOL_NAME.draft_claim_document, output: out });
  }

  // Read before the fallback below fills `decision` in: "the agent decided" and "the code ended the run" differ.
  const reachedDecision = decision !== null;
  if (!decision) {
    const reason = failure ?? `no decision after ${maxSteps} steps`;
    log(`Agent did not reach a decision: ${reason}`);
    emit({ type: "notice", code: "agent_incomplete", message: `The agent did not reach a decision: ${scrub(reason, 160)}. A human must handle this case.` });
    decision = {
      decision: "no_action",
      carrierClaim: false,
      confidence: 0,
      reasons: [`The agent could not finish this case (${reason}). A human must handle it.`],
      needsHuman: true,
      customerReply: "",
    };
  } else if (failure) {
    log(`Agent error after the decision was recorded: ${failure}`);
    emit({ type: "notice", code: "agent_error", message: `The model failed after the decision was recorded: ${scrub(failure, 160)}.` });
  }

  log(`Case ready for review: ${decision.decision}${decision.needsHuman ? " (needs a human)" : ""}`);
  emit({
    type: "run_finished",
    reachedDecision,
    decision: decision.decision,
    confidence: decision.confidence,
    needsHuman: decision.needsHuman,
    carrierClaim: decision.carrierClaim,
    ms: Date.now() - startedAt,
  });
  return snapshot();
}
