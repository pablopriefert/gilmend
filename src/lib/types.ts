// Shared contracts for every lot of Gilmend. Lots code against these types and
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

/**
 * Which engine produced a case. 'demo-mock' is the deterministic mock provider (no key).
 * 'open-weights' is the "Run privately" engine: an open-weights Muse model, hosted by Baseten
 * or served on Modal or elsewhere (see EngineDetail for which). 'openrouter' is a test engine
 * for cheap bulk runs: never private, never the default.
 */
export type Engine = "muse-spark-1.3" | "open-weights" | "openrouter" | "demo-mock";

/** Where the model of a run is served. */
export type EngineHost = "meta" | "baseten" | "modal" | "openrouter" | "custom" | "mock";

/**
 * Which model and host really ran a case, stored with it. `engine` alone cannot say it for
 * open weights (Muse Spark Open on Baseten, Muse Glimmer on Modal...), and the claim PDF, which
 * goes to a carrier, must not call an open-weights run by a vaguer name than the truth.
 */
export interface EngineDetail {
  /** Model id sent to the server (an id, never a key). */
  model: string;
  host: EngineHost;
  /** Full sentence-case name for documents, e.g. "Muse Spark Open (open weights, served by Baseten)". */
  label: string;
  /** Short name for badges and lists, e.g. "Muse Spark Open on Baseten". */
  short: string;
}

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
  /** Photo with what SAM matched outlined (the item, its pieces or the box, not the damage itself); null when the SAM call failed or was skipped. */
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
  /**
   * Round of the case this step belongs to, from round 2 on (a follow-up from the customer, see
   * FollowUp). Absent means round 1: every trace saved before follow-ups existed has no round.
   */
  round?: number;
}

/**
 * Set only on the committed showcase cases (data/showcase/): a REAL run of Muse Spark 1.3 and
 * SAM 3.1 that was recorded once and shipped with the code, so a fresh deployment is not empty.
 * The recording is read-only: a merchant action on it is stored as a copy (see
 * src/lib/store/layered-store.ts) and the committed files never change.
 */
export interface RecordedRun {
  /** Day the run was recorded, ISO date (YYYY-MM-DD). */
  recordedOn: string;
}

/**
 * What the customer sent back after the agent asked for more (more photos, a corrected order
 * number). It starts the next round of the SAME case: the agent resumes with everything it knew
 * (see resumeAgent). `CaseRecord.report` stays the original report, untouched.
 */
export interface FollowUp {
  id: string;
  /** ISO date-time the reply was filed. The carrier deadlines never count from it (see computeClaim). */
  receivedAt: string;
  /** The customer's words; may be empty when the reply is only photos. */
  message: string;
  /** Stored paths of the new photos (0 to 3), same format as DamageReport.photos. */
  photos: string[];
  /** Corrected order number, only when the first one matched no order. */
  orderNumber?: string;
  /**
   * True when the server recognised the photo of the "simulate the customer's reply" demo button
   * (byte for byte): the reply is a rehearsal, not something a customer wrote. Set by the server,
   * never taken from the request.
   */
  simulated?: boolean;
}

/**
 * A finished round that the next round replaced as the case's current state. The top-level fields
 * of CaseRecord (assessment, claim, decision, evidence, document, engine) always describe the
 * LATEST round, so everything that read a case before follow-ups existed keeps working; the
 * rounds before it are kept here, in order: previousRounds[0] is round 1.
 */
export interface PreviousRound {
  /** 1 for the original report, 2 for the first follow-up... */
  number: number;
  /** Case status when the next round started ("approved": the request for more photos was approved). */
  status: CaseStatus;
  order: Order | null;
  assessment: DamageAssessment | null;
  claim: ClaimComputation | null;
  decision: Decision | null;
  evidence: Evidence[];
  document: ClaimDocument | null;
  engine: Engine;
  engineDetail?: EngineDetail;
  /** Set when this round was a recorded showcase run (round 1 of a showcase case only). */
  recorded?: RecordedRun;
  /** ISO date-time the round ended (the case's updatedAt when the next round replaced it). */
  finishedAt: string;
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
  /** Model and host that ran the case. Absent on cases saved before it existed. */
  engineDetail?: EngineDetail;
  trace: TraceStep[];
  createdAt: string;
  updatedAt: string;
  /**
   * Present on recorded showcase runs only. Dropped when a follow-up starts round 2 (the case is
   * then partly live): the recording is kept as `previousRounds[0].recorded`.
   */
  recorded?: RecordedRun;
  /**
   * The customer's replies, oldest first. Absent on cases saved before follow-ups existed and on
   * every case that was never followed up: that is round 1 only. Round number of the case now =
   * 1 + followUps.length (see src/lib/rounds.ts).
   */
  followUps?: FollowUp[];
  /** The rounds that the latest one replaced, oldest first (see PreviousRound). Same length as followUps. */
  previousRounds?: PreviousRound[];
  /**
   * Set when this case is the continuation of a RECORDED showcase run (28 Oct 2026): the customer's
   * reply on a recording is saved as a new case that starts from a copy of it, and this is the id of
   * the recording. The recording itself is never changed, so the demo can be played again.
   */
  followedFrom?: string;
}
