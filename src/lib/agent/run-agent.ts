import { randomUUID } from "node:crypto";
import type {
  ChatCompletionContentPart,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { describeEngine, resolveEngine, type Env } from "../config";
import { buildClaimDocument } from "../documents/claim-pdf";
import { DEFAULT_DAMAGE_CONCEPTS, damageConceptFor, markDamage } from "../evidence/mark-damage";
import { getOrder } from "../orders";
import { getProvider, type Provider } from "../providers";
import { computeClaim, getCarrierRules } from "../rules/carriers";
import type {
  CaseRecord,
  ClaimComputation,
  ClaimDocument,
  DamageAssessment,
  DamageReport,
  Decision,
  Engine,
  Evidence,
  Order,
  TraceStep,
} from "../types";
import { applyGuardrails } from "./guardrails";
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

/** Maximum number of model turns (a turn may contain several parallel tool calls). */
export const MAX_AGENT_STEPS = 8;

/**
 * Wall-clock budget of a real run (ms). The route is capped by the platform (maxDuration on
 * Vercel): a slow model must end in a "needs a human" case that carries the trace, not in a
 * function killed before anything was saved. The mock is instant and has no budget.
 */
export const DEFAULT_TIME_BUDGET_MS = 90_000;
/** One model call never waits longer than this, nor longer than what is left of the budget. */
const MODEL_CALL_TIMEOUT_MS = 45_000;
const MIN_MODEL_CALL_TIMEOUT_MS = 5_000;

/** The collaborators of the loop. Injectable so tests never touch disk, network or other lots. */
export interface AgentDeps {
  getOrder: typeof getOrder;
  markDamage: typeof markDamage;
  getCarrierRules: typeof getCarrierRules;
  computeClaim: typeof computeClaim;
  buildClaimDocument: typeof buildClaimDocument;
}

export interface RunAgentOptions {
  engine: Engine;
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
}

const DEFAULT_DEPS: AgentDeps = {
  getOrder: (...a) => getOrder(...a),
  markDamage: (...a) => markDamage(...a),
  getCarrierRules: (...a) => getCarrierRules(...a),
  computeClaim: (...a) => computeClaim(...a),
  buildClaimDocument: (...a) => buildClaimDocument(...a),
};

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Run the tool-calling agent on one customer report and return the resulting case
 * (status 'needs_review': nothing is sent anywhere, the merchant approves later).
 * The case is NOT saved here; the caller stores it (saveCase).
 *
 * This function never throws for model, tool or provider problems: they end up in
 * `trace` and the case goes to the merchant with needsHuman=true, so the UI never crashes.
 */
export async function runAgent(report: DamageReport, opts: RunAgentOptions): Promise<CaseRecord> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const maxSteps = opts.maxSteps ?? MAX_AGENT_STEPS;
  const deps: AgentDeps = { ...DEFAULT_DEPS, ...opts.deps };
  const createdAt = new Date().toISOString();

  const trace: TraceStep[] = [];
  const log = (step: string, extra: Omit<TraceStep, "step" | "at"> = {}) => {
    trace.push({
      step,
      ...(extra.tool ? { tool: extra.tool } : {}),
      ...(extra.input !== undefined ? { input: redactForTrace(extra.input) } : {}),
      ...(extra.output !== undefined ? { output: redactForTrace(extra.output) } : {}),
      at: new Date().toISOString(),
    });
  };

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
  const caseId = opts.caseId ?? `case_${randomUUID()}`;
  const startedAt = Date.now();
  const evidence: Evidence[] = [];
  const toolErrors: string[] = [];
  const toolOutputs: unknown[] = [];
  let failure: string | null = null;
  // True when the model was not shown the photos (its server cannot read images, or refused
  // them). Then nothing it says about damage comes from the photos, and the case goes to a human.
  let photosNotRead = false;

  const snapshot = (): CaseRecord => ({
    id: caseId,
    report,
    order,
    assessment,
    claim,
    decision,
    evidence: [...evidence],
    document,
    status: "needs_review",
    engine,
    engineDetail: provider?.detail ?? describeEngine(engine, env),
    trace: [...trace],
    createdAt,
    updatedAt: new Date().toISOString(),
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
        // What SAM outlines is what the model names: Muse reads the photo, then tells SAM
        // the concept to segment. Fallbacks (the concept of the recorded assessment, then
        // the generic vocabulary) cover a missing or rejected concept; one concept per SAM call.
        const concept = parseConcept(args.concept);
        const concepts = [
          ...new Set(
            [concept, damageConceptFor(assessment), ...DEFAULT_DAMAGE_CONCEPTS].filter(
              (c): c is string => typeof c === "string",
            ),
          ),
        ].slice(0, 4);
        let ev: Evidence;
        try {
          // `engine` decides whether SAM may run at all: not for a private run, not in demo mode.
          ev = await deps.markDamage(photo, { engine, concepts });
        } catch (e) {
          // markDamage should never throw; if it does the claim still ships with the raw photo.
          ev = { photo, annotatedPhoto: null, method: "none", note: `mark_damage failed: ${errMessage(e)}` };
        }
        const at = evidence.findIndex((x) => x.photo === photo);
        if (at >= 0) evidence[at] = ev;
        else evidence.push(ev);
        // Never send the image back to the model: only whether the outline worked.
        return {
          photoIndex: idx,
          annotated: ev.annotatedPhoto !== null,
          method: ev.method,
          note: ev.note,
          ...(args.concept !== undefined && concept === null
            ? { conceptIgnored: "concept must be 1 to 4 lowercase words (a noun phrase); the default vocabulary was used" }
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
        const result = applyGuardrails(d.value, {
          order,
          quotedOrderNumber: report.orderNumber,
          assessment,
          claim,
          toolErrors,
          toolOutputs,
          reportReceivedAt: report.receivedAt,
          photosNotRead,
        });
        decision = result.decision;
        for (const adj of result.adjustments) log(`Guardrail: ${adj}`);
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

  async function draftDocument(): Promise<unknown> {
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
      }
      return toolError("draft_claim_document", `claim document failed: ${errMessage(e)}`);
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

  const content: ChatCompletionContentPart[] = [];
  const attached: number[] = [];
  const imageParts: ChatCompletionContentPart[] = [];

  /**
   * Tell the model, and the trace, that it will not see the photos. Used when the engine's model
   * cannot read images and when its server refused them: in both cases the run goes on (the report
   * text, the order and the carrier rules are still useful) but never pretends to have read them.
   */
  const withholdPhotos = (why: string) => {
    photosNotRead = true;
    attached.length = 0;
    content.splice(
      0,
      content.length,
      { type: "text", text: formatReportMessage(report, []) },
      {
        type: "text",
        text: `System note: the customer's photos were NOT shown to you (${why}). You cannot judge the damage from them. Do not guess what they show, do not call assess_photos or compute_claim: call finish_case with needsHuman=true and say in the reasons that the photos were not read by the model.`,
      },
    );
    log(
      `The photos were NOT read by the model (${why}). Nothing in this case comes from looking at them: it goes to a human.`,
    );
  };

  if (provider && provider.supportsImages === false && report.photos.length > 0) {
    withholdPhotos(`${provider.model} is configured without image input`);
  } else {
    for (let i = 0; i < report.photos.length; i++) {
      try {
        const url = await photoToImageUrl(report.photos[i]);
        imageParts.push({ type: "image_url", image_url: { url } });
        attached.push(i);
      } catch (e) {
        log(`Photo ${i} could not be read and was not sent to the model: ${errMessage(e)}`);
      }
    }
    content.push({ type: "text", text: formatReportMessage(report, attached) }, ...imageParts);
  }
  log(`Report received (${attached.length} photo(s) attached)`, {
    input: { orderNumber: report.orderNumber, language: report.language },
  });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content },
  ];

  // ---- the loop ---------------------------------------------------------------------

  const budgetMs = opts.timeBudgetMs ?? (engine === "demo-mock" ? Infinity : DEFAULT_TIME_BUDGET_MS);
  let nudged = false;
  for (let step = 1; provider && step <= maxSteps; step++) {
    const remainingMs = budgetMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      failure = `the time budget of ${Math.round(budgetMs / 1000)} s ran out before step ${step}`;
      break;
    }
    let completion;
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
          break;
        }
      } else {
        failure = `model call failed at step ${step}: ${errMessage(e)}`;
        break;
      }
    }
    const message = completion.choices?.[0]?.message;
    if (!message) {
      failure = `model returned no message at step ${step}`;
      break;
    }
    const calls = (message.tool_calls ?? []).filter(
      (c): c is ChatCompletionMessageFunctionToolCall => c.type === "function",
    );
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
      try {
        output = await runTool(name, call.function.arguments);
      } catch (e) {
        output = toolError(name, `tool "${name}" crashed: ${errMessage(e)}`);
      }
      const isError = typeof output === "object" && output !== null && "error" in output;
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

  // The model decided a claim is due but never drafted it (step limit, or it stopped):
  // draft it ourselves, the document is deterministic and the merchant expects it.
  if (decision?.carrierClaim && !document && order && claim?.eligible) {
    log("Claim document not drafted by the model; generating it");
    const out = await draftDocument();
    log("Tool: draft_claim_document (automatic)", { tool: TRACE_TOOL_NAME.draft_claim_document, output: out });
  }

  if (!decision) {
    const reason = failure ?? `no decision after ${maxSteps} steps`;
    log(`Agent did not reach a decision: ${reason}`);
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
  }

  log(`Case ready for review: ${decision.decision}${decision.needsHuman ? " (needs a human)" : ""}`);
  return snapshot();
}
