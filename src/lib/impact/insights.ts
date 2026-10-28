import { getCarrierRulesDetailed } from "../rules/carriers";
import type { ReserveBasis } from "../rules/schema";
import { isRecoverable } from "../store/summary";
import type { CarrierId, CaseRecord, DecisionKind } from "../types";

// The numbers behind the "Insights" band of the Cases page (27 Oct 2026): money and claims per
// carrier, the claim and reserve windows that close in the next 14 days, and the mix of
// decisions. Pure functions of the stored cases: nothing here reads a clock or the disk, and
// every amount is a `maxCompensationEur` that deterministic code computed (never a model).
//
// Two rules inherited from the hero counter (src/lib/store/summary.ts):
//  - a recorded showcase run is a snapshot of 27 Oct 2026, not money the merchant can still
//    chase today, so it only counts when the caller asks for it (`includeRecorded`);
//  - when it does count, it is read as of its own recording (`readAt`), the same frozen clock the
//    case list uses, so it never silently turns "overdue" a few days after the recording.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Mondial Relay and Chronopost first: their windows are the short ones, the ones that lose money. */
export const CARRIER_ORDER: readonly CarrierId[] = ["mondial_relay", "chronopost", "colissimo", "dhl_paket", "gls"];

export const DECISION_ORDER: readonly DecisionKind[] = ["reship", "refund", "ask_more_photos", "no_action"];

/** Days ahead the deadline timeline looks. */
export const TIMELINE_HORIZON_DAYS = 14;

/** A claim closing within this many days is flagged as urgent (the same limit as the case list). */
export const URGENT_DAYS = 3;

export interface InsightsOptions {
  /** Count the committed recorded runs too, each read as of its own recording day. */
  includeRecorded: boolean;
  /** Defaults to TIMELINE_HORIZON_DAYS. */
  horizonDays?: number;
}

export interface CarrierInsight {
  carrier: CarrierId;
  /** Recoverable cases of this carrier (see isRecoverable). */
  openClaims: number;
  recoverableEur: number;
  /** "3 days after delivery", from the carrier rules. */
  windowLabel: string;
  /** "72 h reserve window (prudential)" or "168 h reserve window (statutory)", from the carrier rules. */
  reserveLabel: string;
}

export interface TimelineEvent {
  caseId: string;
  orderId: string;
  carrier: CarrierId;
  /** claim: the last day to file; reserve: the end of the window to state reserves after delivery. */
  kind: "claim" | "reserve";
  /** A reserve window that only warns (Colissimo, DHL Paket, GLS) and does not block a claim. */
  binding: boolean;
  /** Where a reserve window comes from (carrier terms, the law, our own prudence); "carrier" on a claim event. */
  basis: ReserveBasis;
  /** ISO date-time of the deadline. */
  at: string;
  /** Hours from the moment the case is read to the deadline (a recorded run: from its recording). */
  hoursFromRead: number;
  urgent: boolean;
  /** Only on claim events (a reserve event of the same case would count the money twice). */
  amountEur: number | null;
  /** Day of the recording (YYYY-MM-DD) for a recorded run, null for a live case. */
  recordedOn: string | null;
}

export interface LaterClaims {
  count: number;
  eur: number;
  /** ISO date-time of the first of them. */
  firstAt: string | null;
}

export interface DecisionInsight {
  decision: DecisionKind;
  count: number;
  /** 0 to 1 of the cases that have a decision. */
  share: number;
}

export interface Insights {
  includeRecorded: boolean;
  /** Cases counted (live, plus recorded when included). */
  cases: number;
  openClaims: number;
  recoverableEur: number;
  carriers: CarrierInsight[];
  timeline: {
    horizonDays: number;
    events: TimelineEvent[];
    later: LaterClaims;
  };
  decisions: {
    /** Cases with a decision; the others are still being worked (status new). */
    total: number;
    items: DecisionInsight[];
    needsHuman: number;
    withCarrierClaim: number;
  };
  /** Counted cases that came from DEMO MODE (scripted decisions, not Muse). */
  demoModeCases: number;
}

/** The moment a case is read against: now for a live case, its recording for a recorded run. */
function readAt(c: CaseRecord, now: Date): Date {
  return c.recorded ? new Date(c.createdAt) : now;
}

function toCents(eur: number): number {
  return Math.round(eur * 100);
}

/**
 * "3 days after delivery" / "365 days after shipment (counted from the order date, the safe
 * side)": what the rules say, not a copy of it. The carrier's own wording for Colissimo is after
 * shipment (27 Oct 2026 review: a label saying "after the order" misquoted the terms); the app
 * only counts from the order date because the order has no pick-up date, which closes the window
 * earlier than the real one.
 */
export function windowLabel(carrier: CarrierId): string {
  const short = windowLabelShort(carrier);
  return getCarrierRulesDetailed(carrier).claimDeadlineFrom === "delivery"
    ? short
    : `${short} (counted from the order date, the safe side)`;
}

/** The carrier's own wording, without the note on how the app counts it ("365 days after shipment"). */
export function windowLabelShort(carrier: CarrierId): string {
  const rules = getCarrierRulesDetailed(carrier);
  const days = rules.claimDeadlineDays;
  return `${days} ${days === 1 ? "day" : "days"} after ${rules.claimDeadlineFrom === "delivery" ? "delivery" : "shipment"}`;
}

export function reserveLabel(carrier: CarrierId): string {
  const rules = getCarrierRulesDetailed(carrier);
  // A window that blocks says nothing more; one that only warns says where it comes from (statutory for
  // DHL Paket and GLS, prudential for Colissimo): "prudential" would be wrong for a deadline of the HGB.
  return `${rules.reserveDeadlineHours} h reserve window${rules.reserveDeadlineBinding ? "" : ` (${rules.reserveDeadlineBasis})`}`;
}

export function buildInsights(all: CaseRecord[], now: Date, options: InsightsOptions): Insights {
  const horizonDays = options.horizonDays ?? TIMELINE_HORIZON_DAYS;
  const horizonMs = horizonDays * DAY_MS;
  const counted = options.includeRecorded ? all : all.filter((c) => !c.recorded);

  // --- carriers ------------------------------------------------------------------------
  const perCarrier = new Map<CarrierId, { cents: number; claims: number }>(
    CARRIER_ORDER.map((id) => [id, { cents: 0, claims: 0 }]),
  );
  const events: TimelineEvent[] = [];
  const later: { count: number; cents: number; firstMs: number | null } = { count: 0, cents: 0, firstMs: null };

  for (const c of counted) {
    const carrier = c.order?.carrier;
    if (!carrier || !perCarrier.has(carrier) || !c.claim) continue;
    const at = readAt(c, now);
    if (!isRecoverable(c, at)) continue;

    const bucket = perCarrier.get(carrier)!;
    const cents = toCents(c.claim.maxCompensationEur);
    bucket.cents += cents;
    bucket.claims += 1;

    const claimMs = c.claim.claimDeadline === null ? NaN : Date.parse(c.claim.claimDeadline);
    const reserveMs = c.claim.reserveDeadline === null ? NaN : Date.parse(c.claim.reserveDeadline);
    const readMs = at.getTime();
    const orderId = c.order?.id ?? c.report.orderNumber;
    const recordedOn = c.recorded?.recordedOn ?? null;
    const base = { caseId: c.id, orderId, carrier, recordedOn };

    if (Number.isFinite(claimMs)) {
      if (claimMs - readMs <= horizonMs) {
        events.push({
          ...base,
          kind: "claim",
          binding: true,
          basis: "carrier",
          at: new Date(claimMs).toISOString(),
          hoursFromRead: (claimMs - readMs) / HOUR_MS,
          urgent: claimMs - readMs <= URGENT_DAYS * DAY_MS,
          amountEur: c.claim.maxCompensationEur,
        });
      } else {
        later.count += 1;
        later.cents += cents;
        later.firstMs = later.firstMs === null ? claimMs : Math.min(later.firstMs, claimMs);
      }
    }
    // The reserve window is its own event only when it closes at another moment than the claim
    // (Colissimo: 72 h, then 12 months). For Mondial Relay and Chronopost the two coincide and
    // one marker says it. A window already closed when the case is read is not a deadline any more.
    if (
      Number.isFinite(reserveMs) &&
      reserveMs > readMs &&
      reserveMs - readMs <= horizonMs &&
      (!Number.isFinite(claimMs) || Math.abs(reserveMs - claimMs) > 60_000)
    ) {
      events.push({
        ...base,
        kind: "reserve",
        binding: getCarrierRulesDetailed(carrier).reserveDeadlineBinding,
        basis: getCarrierRulesDetailed(carrier).reserveDeadlineBasis,
        at: new Date(reserveMs).toISOString(),
        hoursFromRead: (reserveMs - readMs) / HOUR_MS,
        urgent: reserveMs - readMs <= URGENT_DAYS * DAY_MS,
        amountEur: null,
      });
    }
  }

  events.sort((a, b) => a.hoursFromRead - b.hoursFromRead || a.caseId.localeCompare(b.caseId));

  const carriers: CarrierInsight[] = CARRIER_ORDER.map((carrier) => {
    const b = perCarrier.get(carrier)!;
    return {
      carrier,
      openClaims: b.claims,
      recoverableEur: b.cents / 100,
      windowLabel: windowLabel(carrier),
      reserveLabel: reserveLabel(carrier),
    };
  });
  const totalCents = [...perCarrier.values()].reduce((sum, b) => sum + b.cents, 0);
  const openClaims = [...perCarrier.values()].reduce((sum, b) => sum + b.claims, 0);

  // --- decisions -----------------------------------------------------------------------
  const withDecision = counted.filter((c) => c.decision !== null);
  const total = withDecision.length;
  const items = DECISION_ORDER.map((decision): DecisionInsight => {
    const count = withDecision.filter((c) => c.decision?.decision === decision).length;
    return { decision, count, share: total === 0 ? 0 : count / total };
  });

  return {
    includeRecorded: options.includeRecorded,
    cases: counted.length,
    openClaims,
    recoverableEur: totalCents / 100,
    carriers,
    timeline: {
      horizonDays,
      events,
      later: {
        count: later.count,
        eur: later.cents / 100,
        firstAt: later.firstMs === null ? null : new Date(later.firstMs).toISOString(),
      },
    },
    decisions: {
      total,
      items,
      needsHuman: withDecision.filter((c) => c.decision?.needsHuman).length,
      withCarrierClaim: withDecision.filter((c) => c.decision?.carrierClaim).length,
    },
    demoModeCases: counted.filter((c) => c.engine === "demo-mock").length,
  };
}

/** "in 2 d 4 h", "in 5 h", "in under 1 h": a countdown for a number of hours (negative = passed). */
export function formatCountdown(hours: number): string {
  if (!Number.isFinite(hours)) return "unknown";
  if (hours < 0) return "passed";
  if (hours < 1) return "in under 1 h";
  const whole = Math.floor(hours);
  const d = Math.floor(whole / 24);
  const h = whole % 24;
  if (d === 0) return `in ${h} h`;
  return h === 0 ? `in ${d} d` : `in ${d} d ${h} h`;
}
