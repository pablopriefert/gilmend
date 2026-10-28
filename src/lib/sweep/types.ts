import type { CarrierId, CaseStatus, Engine, EngineDetail } from "../types";
import type { MissingInfo } from "../rounds";

// The shapes of the morning sweep (29 Oct 2026, "Today" panel). A sweep is stored as ONE JSON
// object (the latest) and sent to the browser as it is, so it holds nothing that identifies a
// customer: no name, no e-mail, no address, no message. An order number and an item title are
// what the merchant already sees in the list.
//
// Who writes what:
//  - CODE: which cases are listed, in which order, every deadline, countdown and amount;
//  - MODEL (or the labelled demo script): only the briefing paragraph and the nudge drafts, and a
//    text that states a figure the code did not give it is thrown away (see text.ts).

/** Why a case is on the plan. A case can have several; they are listed most pressing first. */
export type SweepReasonKind =
  | "claim_deadline"
  | "reserve_window"
  | "waiting_on_customer"
  | "claim_not_filed"
  | "needs_human"
  | "stuck_run"
  | "awaiting_click";

export interface SweepReason {
  kind: SweepReasonKind;
  /** One sentence of plain English written by the code, with its own figures. */
  text: string;
}

/** What to do about the case, in one verb. Picked by the code, never by the model. */
export type SweepAction = "nudge_customer" | "file_claim" | "review_case" | "check_failed_run";

export interface SweepDeadline {
  /** claim: the last day to file. reserve: the end of the window to state reserves after delivery. */
  kind: "claim" | "reserve";
  /** ISO date-time of the deadline, from computeClaim (stored on the case), never from a model. */
  at: string;
  /** Hours from the moment the case was read (`readAt`) to the deadline. */
  hoursLeft: number;
  /** A reserve window that only warns (Colissimo) and does not block a claim. */
  binding: boolean;
}

/** A piece of text that a model, a labelled demo script or a plain template wrote. */
export interface SweepText {
  text: string;
  /**
   * model: written by the engine named on the sweep. demo-mock: written by the labelled DEMO MODE
   * script, not by Muse. template: filled in by plain code (the model was not used or its text
   * was refused); `note` says which.
   */
  source: "model" | "demo-mock" | "template";
  /** Model id when source is "model". */
  model?: string;
  /** Why a template stands in for the model, when it does. */
  note?: string;
  /** Hash of what the writer was given (engine included): the same input the same day reuses this text. */
  inputKey: string;
}

export interface SweepItem {
  /** 1 = do this first. */
  rank: number;
  caseId: string;
  /** Order number as the merchant sees it ("#1004"). */
  orderId: string;
  /** What was damaged, from the claim basis or the assessment, trimmed. */
  itemTitle: string;
  carrier: CarrierId | null;
  carrierLabel: string | null;
  status: CaseStatus;
  /** The engine that ran the case itself (a private case never goes to the Meta Model API again). */
  caseEngine: Engine;
  /** Day of the recording for a recorded run included on purpose, else null. */
  recordedOn: string | null;
  /** The moment the case was read against: the sweep's time, or the recording for a recorded run. */
  readAt: string;
  action: SweepAction;
  reasons: SweepReason[];
  /** The earliest deadline still ahead, or null. */
  deadline: SweepDeadline | null;
  /** True when that deadline is inside the sweep's horizon (72 h). */
  withinHorizon: boolean;
  /** Most the carrier could pay (computeClaim), 0 when no claim is open or the amount is not known yet. */
  amountEur: number;
  /** Set when the case waits for the customer's reply (the request was approved and no reply was added). */
  waiting: { since: string; hours: number; missing: MissingInfo[] } | null;
  /**
   * A reply on this case is the simulated one of the demo button: its amount is shown but left out
   * of the sweep's total, like the header counter does.
   */
  simulatedReply: boolean;
  /** The customer's language (ISO 639-1), for the nudge. */
  language: string;
  /** A draft to copy for a case that waits on the customer. Nothing is ever sent. */
  nudge: SweepText | null;
}

export interface SweepCounts {
  /** Cases the sweep looked at (recorded runs only when asked for). */
  cases: number;
  /** Of those, not rejected and not closed. */
  open: number;
  /** Items on the plan (before the cap on the list). */
  due: number;
  /** Items with a deadline inside the horizon. */
  closingSoon: number;
  waitingOnCustomer: number;
  claimsNotFiled: number;
  needHuman: number;
}

/** The plan as the code computes it, before any text is written. */
export interface SweepPlan {
  includeRecorded: boolean;
  horizonHours: number;
  waitingHours: number;
  counts: SweepCounts;
  /** Sum of the amounts of every item: money that could still be claimed, never a promise. */
  moneyAtStakeEur: number;
  /** Ranked items, at most MAX_LISTED_ITEMS. */
  items: SweepItem[];
  /** How many items the cap left out of `items`. */
  moreItems: number;
}

export interface SweepResult extends SweepPlan {
  version: 1;
  /** ISO date-time the sweep ran. */
  generatedAt: string;
  /** Calendar day (Europe/Paris, YYYY-MM-DD): the day the texts are cached for. */
  day: string;
  trigger: "manual" | "cron";
  /** The engine that wrote the briefing, as it must be labelled on screen. */
  engine: Engine;
  engineDetail: EngineDetail;
  /** Why a real engine was not used: no key here, or the daily cap of real runs was reached. */
  fellBackReason: "no_credentials" | "daily_limit" | null;
  briefing: SweepText;
  /** Model calls this sweep made (a reused text costs none). Never more than SWEEP_MAX_MODEL_CALLS. */
  modelCalls: { briefing: number; nudges: number; total: number; cap: number };
  /** Texts taken from today's earlier sweep instead of asking the model again. */
  reusedTexts: number;
  /** Nudges the cap on model calls left to the plain template. */
  nudgesOverCap: number;
  /** Token counts reported by the engine, summed; null when it reported none (or the mock). */
  usage: { promptTokens: number; completionTokens: number } | null;
}
