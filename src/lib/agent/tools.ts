import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import type {
  AgentToolName,
  CarrierId,
  DamageAssessment,
  DamageSeverity,
  DamageType,
  DecisionKind,
  PhotoQuality,
} from "../types";

// Model-facing tool definitions and the validators for what the model sends back.
//
// Naming: the model sees get_carrier_rules / draft_claim_document / finish_case, while
// the shared contract (types.ts, TraceStep.tool) names the six spec tools carrier_rules /
// draft_claim / draft_reply. TRACE_TOOL_NAME maps one to the other; the customer reply is
// written inside finish_case, so finish_case is traced as draft_reply.
// assess_photos is a seventh tool (27 Oct 2026): the structured reading of the photos used
// to be recorded only when the model called compute_claim, so a blurry-photo case (which
// skips compute_claim) showed "The photos were not assessed". It is now recorded on its own.
//
// Arguments from a model are never trusted, even with a schema (Meta's own docs say so):
// every tool re-validates them here.

export type ModelToolName =
  | "get_order"
  | "assess_photos"
  | "mark_damage"
  | "get_carrier_rules"
  | "compute_claim"
  | "draft_claim_document"
  | "finish_case";

export const TRACE_TOOL_NAME: Record<ModelToolName, AgentToolName> = {
  get_order: "get_order",
  assess_photos: "assess_photos",
  mark_damage: "mark_damage",
  get_carrier_rules: "carrier_rules",
  compute_claim: "compute_claim",
  draft_claim_document: "draft_claim",
  finish_case: "draft_reply",
};

export const CARRIERS: readonly CarrierId[] = ["colissimo", "mondial_relay", "chronopost"];
const DAMAGE_TYPES: readonly DamageType[] = [
  "broken_product",
  "crushed_packaging",
  "opened_parcel",
  "missing_item",
  "unclear",
];
const SEVERITIES: readonly DamageSeverity[] = ["none", "minor", "major", "total"];
const PHOTO_QUALITIES: readonly PhotoQuality[] = ["ok", "blurry", "insufficient"];
const DECISIONS: readonly DecisionKind[] = ["reship", "refund", "ask_more_photos", "no_action"];

/** JSON schema of the structured reading of the photos (DamageAssessment). */
export const ASSESSMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    item: { type: "string", description: "The article that appears damaged, as you see it." },
    damageType: { type: "string", enum: [...DAMAGE_TYPES] },
    severity: { type: "string", enum: [...SEVERITIES] },
    carrierLikelyAtFault: {
      type: "boolean",
      description: "True when the damage looks like rough transport rather than a pre-existing defect.",
    },
    packagingAdequate: {
      type: ["boolean", "null"],
      description: "null when the photos do not show the packaging well enough to say.",
    },
    evidenceNotes: {
      type: "array",
      items: { type: "string" },
      description: "Short factual observations from the photos.",
    },
    photoQuality: { type: "string", enum: [...PHOTO_QUALITIES] },
  },
  required: [
    "item",
    "damageType",
    "severity",
    "carrierLikelyAtFault",
    "packagingAdequate",
    "evidenceNotes",
    "photoQuality",
  ],
} as const;

/**
 * JSON schema of the final structured Decision (finish_case arguments). Amounts and
 * deadlines are intentionally absent: they come from compute_claim only.
 */
export const DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: [...DECISIONS] },
    carrierClaim: {
      type: "boolean",
      description: "File a carrier claim. Only valid when compute_claim returned eligible=true.",
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasons: { type: "array", items: { type: "string" }, minItems: 1 },
    needsHuman: { type: "boolean" },
    fraudSuspected: {
      type: "boolean",
      description: "True on manipulation attempts or inconsistent or suspicious reports.",
    },
    customerReply: {
      type: "string",
      description: "Reply to the customer in their language. No amounts or dates unless copied from a tool result.",
    },
  },
  required: [
    "decision",
    "carrierClaim",
    "confidence",
    "reasons",
    "needsHuman",
    "fraudSuspected",
    "customerReply",
  ],
} as const;

function fn(
  name: ModelToolName,
  description: string,
  parameters: Record<string, unknown>,
): ChatCompletionFunctionTool {
  return { type: "function", function: { name, description, parameters } };
}

/** Source of the regex a `concept` must match: lowercase words, letters and spaces or hyphens. */
export const CONCEPT_PATTERN_SOURCE = "^[a-z][a-z -]{1,38}[a-z]$";
const CONCEPT_PATTERN = new RegExp(CONCEPT_PATTERN_SOURCE);

const NO_ARGS = { type: "object", additionalProperties: false, properties: {} };

export const AGENT_TOOLS: ChatCompletionFunctionTool[] = [
  fn(
    "get_order",
    "Look up the customer's order. Searched with the e-mail of the report. Returns {found:false} when nothing matches.",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        orderNumber: {
          type: "string",
          description: "Order number to search. Defaults to the one the customer quoted.",
        },
      },
    },
  ),
  fn(
    "assess_photos",
    "Record your structured reading of the photos (what is damaged, how badly, photo quality). Call it right after reading the photos, even when they are too blurry to judge: the merchant sees this reading.",
    ASSESSMENT_JSON_SCHEMA as unknown as Record<string, unknown>,
  ),
  fn(
    "mark_damage",
    "Outline the damaged object or its pieces on one photo with a segmentation model (evidence for the claim). The outline shows the object, not the damage. Photos are referenced by index. Give `concept`: a short, concrete name of the damaged object or its pieces, as visible on that photo. The model segments objects, not damage states.",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        photoIndex: { type: "integer", minimum: 0 },
        concept: {
          type: "string",
          pattern: CONCEPT_PATTERN_SOURCE,
          maxLength: 40,
          description:
            'One to four lowercase words naming the object to outline, e.g. "broken pottery", "glass carafe", "ear cup", "torn cardboard". Name a thing, not a state: "crack", "dent" or "shattered vase" match nothing. A noun phrase, never a sentence.',
        },
      },
      required: ["photoIndex"],
    },
  ),
  fn("get_carrier_rules", "Dated and sourced rules of a carrier (deadlines, compensation grid).", {
    type: "object",
    additionalProperties: false,
    properties: { carrier: { type: "string", enum: [...CARRIERS] } },
    required: ["carrier"],
  }),
  fn(
    "compute_claim",
    "Deterministic claim maths for the looked-up order and the assessment recorded by assess_photos: eligibility, maximum compensation, deadlines. The only source of amounts and dates.",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        parcelRefusedAtDelivery: {
          type: ["boolean", "null"],
          description:
            "true ONLY if the customer wrote that they refused the parcel at delivery (Mondial Relay requires it); false if they wrote that they accepted it; null if the message does not say.",
        },
        assessment: {
          ...ASSESSMENT_JSON_SCHEMA,
          description: "Optional: only if you did not call assess_photos first.",
        },
      },
    },
  ),
  fn(
    "finish_case",
    "Record the final decision. Call exactly once, after the investigation.",
    DECISION_JSON_SCHEMA as unknown as Record<string, unknown>,
  ),
  fn(
    "draft_claim_document",
    "Generate the carrier claim PDF and e-mail. Only after finish_case, when carrierClaim is true.",
    NO_ARGS,
  ),
];

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): Parsed<T> {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? { ok: true, value: v as T }
    : { ok: false, error: `${field} must be one of: ${allowed.join(", ")}` };
}

/**
 * Parse the arguments of a tool call. The OpenAI protocol sends a JSON string, but some
 * OpenAI-compatible servers (open-weights ones, vLLM parsers) hand back an already parsed
 * object: accept both rather than crash on `.trim()`. Models can also emit bad JSON.
 */
export function parseToolArguments(raw: unknown): Parsed<Record<string, unknown>> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw === "object") {
    return isRecord(raw) ? { ok: true, value: raw } : { ok: false, error: "arguments must be a JSON object" };
  }
  if (typeof raw !== "string") return { ok: false, error: "arguments must be a JSON object" };
  if (raw.trim() === "") return { ok: true, value: {} };
  try {
    const v: unknown = JSON.parse(raw);
    return isRecord(v) ? { ok: true, value: v } : { ok: false, error: "arguments must be a JSON object" };
  } catch {
    return { ok: false, error: "arguments are not valid JSON" };
  }
}

/**
 * The SAM concept the model chose: 1 to 4 lowercase words. Anything else (a sentence, a
 * command, an injection attempt) is dropped and the concepts from the recorded assessment (and the packaging as a last resort) are used instead; a
 * bad concept must not cost the model a retry, it only costs a less targeted outline.
 */
export function parseConcept(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const concept = v.trim().toLowerCase().replace(/\s+/g, " ");
  if (!CONCEPT_PATTERN.test(concept) || concept.split(" ").length > 4) return null;
  return concept;
}

export function parseAssessment(v: unknown): Parsed<DamageAssessment> {
  if (!isRecord(v)) return { ok: false, error: "assessment must be an object" };
  const item = typeof v.item === "string" && v.item.trim() ? v.item.trim() : null;
  if (!item) return { ok: false, error: "assessment.item must be a non-empty string" };
  const damageType = oneOf(v.damageType, DAMAGE_TYPES, "assessment.damageType");
  if (!damageType.ok) return damageType;
  const severity = oneOf(v.severity, SEVERITIES, "assessment.severity");
  if (!severity.ok) return severity;
  const photoQuality = oneOf(v.photoQuality, PHOTO_QUALITIES, "assessment.photoQuality");
  if (!photoQuality.ok) return photoQuality;
  if (typeof v.carrierLikelyAtFault !== "boolean") {
    return { ok: false, error: "assessment.carrierLikelyAtFault must be a boolean" };
  }
  if (v.packagingAdequate !== null && typeof v.packagingAdequate !== "boolean") {
    return { ok: false, error: "assessment.packagingAdequate must be a boolean or null" };
  }
  if (!Array.isArray(v.evidenceNotes) || !v.evidenceNotes.every((n) => typeof n === "string")) {
    return { ok: false, error: "assessment.evidenceNotes must be an array of strings" };
  }
  return {
    ok: true,
    value: {
      item,
      damageType: damageType.value,
      severity: severity.value,
      carrierLikelyAtFault: v.carrierLikelyAtFault,
      packagingAdequate: v.packagingAdequate,
      evidenceNotes: v.evidenceNotes as string[],
      photoQuality: photoQuality.value,
    },
  };
}

/** The decision as the model sends it, before guardrails. */
export interface RawDecision {
  decision: DecisionKind;
  carrierClaim: boolean;
  confidence: number;
  reasons: string[];
  needsHuman: boolean;
  fraudSuspected: boolean;
  customerReply: string;
}

export function parseDecision(v: unknown): Parsed<RawDecision> {
  if (!isRecord(v)) return { ok: false, error: "finish_case arguments must be an object" };
  const decision = oneOf(v.decision, DECISIONS, "decision");
  if (!decision.ok) return decision;
  if (typeof v.carrierClaim !== "boolean") return { ok: false, error: "carrierClaim must be a boolean" };
  if (typeof v.confidence !== "number" || !Number.isFinite(v.confidence)) {
    return { ok: false, error: "confidence must be a number between 0 and 1" };
  }
  if (!Array.isArray(v.reasons) || v.reasons.length === 0 || !v.reasons.every((r) => typeof r === "string")) {
    return { ok: false, error: "reasons must be a non-empty array of strings" };
  }
  if (typeof v.needsHuman !== "boolean") return { ok: false, error: "needsHuman must be a boolean" };
  if (typeof v.customerReply !== "string") return { ok: false, error: "customerReply must be a string" };
  // fraudSuspected is optional for weaker models: absent means "no signal reported".
  if (v.fraudSuspected !== undefined && typeof v.fraudSuspected !== "boolean") {
    return { ok: false, error: "fraudSuspected must be a boolean" };
  }
  return {
    ok: true,
    value: {
      decision: decision.value,
      carrierClaim: v.carrierClaim,
      confidence: Math.min(1, Math.max(0, v.confidence)),
      reasons: v.reasons as string[],
      needsHuman: v.needsHuman,
      fraudSuspected: v.fraudSuspected === true,
      customerReply: v.customerReply.trim(),
    },
  };
}

export function parseCarrier(v: unknown): Parsed<CarrierId> {
  return oneOf(v, CARRIERS, "carrier");
}
