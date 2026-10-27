// Shared contracts for every lot of Damage Desk. Lots code against these types and
// against the stub signatures in the sibling modules; change a type only through the
// orchestrator, otherwise parallel lots stop fitting together.
//
// Conventions:
//  - every date is an ISO 8601 string (UTC) so cases serialise to JSON without loss;
//  - money is a number in the order's currency, except `*Eur` fields which are euros
//    (carrier compensation grids are in euros);
//  - amounts and deadlines NEVER come from the model: they come from carriers.ts rules
//    and computeClaim (deterministic code).

export type CarrierId = "colissimo" | "mondial_relay" | "chronopost";

/** Which engine produced a case. 'demo-mock' is the deterministic mock provider (no key). */
export type Engine = "muse-spark-1.3" | "open-weights" | "demo-mock";

export interface OrderLineItem {
  sku: string;
  title: string;
  quantity: number;
  unitPrice: number;
  imageUrl?: string;
}

export interface Order {
  /** Order number as the customer quotes it, e.g. "#1042". */
  id: string;
  /** Customer name (fictitious data only). */
  name: string;
  email: string;
  createdAt: string;
  /** null while the parcel is not delivered yet. */
  deliveredAt: string | null;
  carrier: CarrierId;
  /** Carrier service, e.g. "Colissimo Domicile sans signature". */
  service: string;
  trackingNumber: string;
  weightKg: number;
  currency: string;
  lineItems: OrderLineItem[];
  total: number;
  shippingAddress: { city: string; country: string };
}

export interface DamageReport {
  id: string;
  receivedAt: string;
  customerEmail: string;
  /** Order number as typed by the customer; may not match any order. */
  orderNumber: string;
  message: string;
  /** File paths or data URLs of the photos sent by the customer (1 to 3). */
  photos: string[];
  /** ISO 639-1 code of the customer's language ("en", "fr"...), used for the reply. */
  language: string;
  /** Present when the message was dictated instead of typed (see POST /api/transcribe). */
  voiceNote?: VoiceNote;
}

/**
 * How a message that started as a voice note was transcribed. The audio itself is never
 * stored: only the text the customer reviewed, and this label.
 */
export interface VoiceNote {
  /** Speech-to-text model, or "demo-mock" when the transcript was a labelled canned one. */
  model: string;
  durationMs: number;
  /** True when no real transcription happened (no key, no access code): canned text. */
  demo: boolean;
  /** True when a transcript is no longer in the message word for word (the customer changed it). */
  edited: boolean;
  /** True when the message also holds typed text around or between the transcripts. */
  partial?: boolean;
}

export type DamageType =
  | "broken_product"
  | "crushed_packaging"
  | "opened_parcel"
  | "missing_item"
  | "unclear";

export type DamageSeverity = "none" | "minor" | "major" | "total";

export type PhotoQuality = "ok" | "blurry" | "insufficient";

/** What the vision model read from the photos. Structured output of the model. */
export interface DamageAssessment {
  /** The article that appears damaged, as the model sees it. */
  item: string;
  damageType: DamageType;
  severity: DamageSeverity;
  carrierLikelyAtFault: boolean;
  /** null when the photos do not show the packaging well enough to say. */
  packagingAdequate: boolean | null;
  evidenceNotes: string[];
  photoQuality: PhotoQuality;
}

export interface CarrierRuleSource {
  title: string;
  url: string;
  /** ISO date (YYYY-MM-DD) when a human last checked this source. */
  checkedOn: string;
}

/** Dated and sourced rules for one carrier. Lives in code/data, never in a prompt. */
export interface CarrierRules {
  carrier: CarrierId;
  label: string;
  sources: CarrierRuleSource[];
  /** Hours after delivery within which the customer must state reserves. */
  reserveDeadlineHours: number;
  /** Days after shipping/delivery within which the claim must be filed. */
  claimDeadlineDays: number;
  compensation: {
    perKgEur?: number;
    flatEur?: number;
    capEur: number;
  };
  /** True when the carrier expects the customer to refuse the damaged parcel. */
  requiresRefusal?: boolean;
  notes: string[];
}

export interface ClaimComputation {
  eligible: boolean;
  /** Plain-English reasons, shown to the merchant and written in the PDF. */
  reasons: string[];
  maxCompensationEur: number;
  /** ISO date-time; null when no claim is possible. */
  claimDeadline: string | null;
  /** ISO date-time; null when the carrier has no reserve deadline or not applicable. */
  reserveDeadline: string | null;
  /** Whole days left before claimDeadline (negative never returned: use eligible=false). */
  daysLeft: number | null;
  /**
   * The terms and figures behind maxCompensationEur, as data, so the claim PDF can write the
   * basis in French without recopying the (English, merchant-facing) `reasons`. Absent when no
   * amount could be computed.
   */
  basis?: ClaimBasis;
}

export interface ClaimBasis {
  /** Label of the terms applied, e.g. "Colissimo Domicile avec signature" or the carrier label. */
  termsLabel: string;
  /** Title of the order line the amount is based on. */
  itemTitle: string;
  itemValueEur: number;
  /** Parcel weight used for a per-kg formula. */
  weightKg: number;
  perKgEur?: number;
  flatEur?: number;
  capEur: number;
}

export type DecisionKind = "reship" | "refund" | "ask_more_photos" | "no_action";

export interface Decision {
  decision: DecisionKind;
  carrierClaim: boolean;
  /** 0 to 1. */
  confidence: number;
  reasons: string[];
  /** Low confidence, high value or fraud signals force this to true. */
  needsHuman: boolean;
  /** Reply to the customer, in the customer's language. Never sent without a click. */
  customerReply: string;
}

export interface Evidence {
  /** Original photo (path or data URL). */
  photo: string;
  /** Photo with the damaged area outlined; null when the SAM call failed or was skipped. */
  annotatedPhoto: string | null;
  /** 'none' means the claim ships with the raw photo. */
  method: "sam-3.1" | "none";
  note: string;
}

export interface ClaimDocument {
  /** Path of the generated PDF (under data/runtime/). */
  pdfPath: string;
  emailSubject: string;
  emailBody: string;
}

export type CaseStatus =
  | "new"
  | "needs_review"
  | "approved"
  | "rejected"
  | "sent_to_customer";

/** The tools of the agent loop (the six of the spec, plus assess_photos: the structured reading of the photos). */
export type AgentToolName =
  | "get_order"
  | "assess_photos"
  | "mark_damage"
  | "carrier_rules"
  | "compute_claim"
  | "draft_claim"
  | "draft_reply";

export interface TraceStep {
  /** Human-readable step label, e.g. "Looked up order #1042". */
  step: string;
  tool?: AgentToolName;
  input?: unknown;
  output?: unknown;
  /** ISO date-time. */
  at: string;
}

export interface CaseRecord {
  id: string;
  report: DamageReport;
  order: Order | null;
  assessment: DamageAssessment | null;
  claim: ClaimComputation | null;
  decision: Decision | null;
  evidence: Evidence[];
  document: ClaimDocument | null;
  status: CaseStatus;
  engine: Engine;
  trace: TraceStep[];
  createdAt: string;
  updatedAt: string;
}
