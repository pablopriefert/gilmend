import { claimIsOpen } from "../claim-filing";
import { getCarrierRulesDetailed } from "../rules/carriers";
import { followUpAvailability, hasSimulatedReply } from "../rounds";
import type { CaseRecord, CaseStatus } from "../types";
import { formatMoment } from "./format";
import type {
  SweepAction,
  SweepCounts,
  SweepDeadline,
  SweepItem,
  SweepPlan,
  SweepReason,
  SweepReasonKind,
} from "./types";

// The morning sweep, the part that is CODE (29 Oct 2026). Given the stored cases and a clock it
// works out what is due and in which order. Nothing here calls a model, reads a clock or touches
// the disk: every deadline is the one computeClaim stored on the case (from the carrier rules,
// never from a model), every amount is that case's `maxCompensationEur`, and the ranking is a
// plain sort, so the same cases at the same moment always give the same plan.
//
// Ranking, in this order (a test pins each rule):
//  1. the deadline still ahead, soonest first, counted in hours from the case's OWN clock (the sweep's
//     time, or the recording's for a recorded run), so the order always matches the countdowns shown
//     (a case with no deadline comes after every case that has one);
//  2. the money, most first (cents, so 23.0 + 9.2 never ties on floating-point dust);
//  3. what has to be done: nudge, then file, then review, then check a failed run;
//  4. the customer who has waited longest;
//  5. the case id, so two runs never swap equal cases.

const HOUR_MS = 3_600_000;

/** A deadline closer than this is "due soon" (the window asked for: the next 72 hours). */
export const SWEEP_HORIZON_HOURS = 72;
/** A customer who has not answered after this many hours gets a nudge draft (DAMAGE_DESK_SWEEP_WAITING_HOURS overrides). */
export const SWEEP_WAITING_HOURS = 48;
/** A case still "new" after this long lost its agent run (the function was cut, the model never answered). */
export const SWEEP_STUCK_HOURS = 1;
/** The list keeps at most this many items; the counts still say how many there were. */
export const MAX_LISTED_ITEMS = 30;

export interface SweepSettings {
  horizonHours: number;
  waitingHours: number;
  stuckHours: number;
}

/** The thresholds, from the environment when it names a sensible number of hours (1 to 720). */
export function sweepSettings(env: Record<string, string | undefined> = process.env): SweepSettings {
  const raw = env.DAMAGE_DESK_SWEEP_WAITING_HOURS?.trim();
  const n = raw ? Number(raw) : NaN;
  const waitingHours = Number.isFinite(n) && n >= 1 && n <= 720 ? n : SWEEP_WAITING_HOURS;
  return { horizonHours: SWEEP_HORIZON_HOURS, waitingHours, stuckHours: SWEEP_STUCK_HOURS };
}

export interface PlanOptions {
  /** Read the committed recorded runs too, each as of its own recording day. Default false. */
  includeRecorded?: boolean;
  horizonHours?: number;
  waitingHours?: number;
  stuckHours?: number;
}

const OPEN_STATUSES: readonly CaseStatus[] = ["new", "needs_review", "approved"];

/** Lower comes first when everything else ties. */
const ACTION_ORDER: Record<SweepAction, number> = {
  nudge_customer: 0,
  file_claim: 1,
  review_case: 2,
  check_failed_run: 3,
};

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * What a customer typed as an order number, when no order was found for it. It is free text, so it is
 * used only when it looks like an order number (digits, with at most a short prefix): a name, an
 * e-mail address or a sentence typed there never reaches the plan, the model or the public sweep.
 */
export const UNMATCHED_ORDER = "unmatched order";

const QUOTED_ORDER = /^#?[A-Za-z]{0,4}-?\d{3,12}$/;

export function orderLabel(c: Pick<CaseRecord, "order" | "report">): string {
  if (c.order) return cleanTitle(c.order.id, UNMATCHED_ORDER);
  const quoted = (c.report.orderNumber ?? "").trim();
  return QUOTED_ORDER.test(quoted) ? quoted : UNMATCHED_ORDER;
}

/** An item title is shown and may be sent to a model: one line, no control characters, bounded. */
export function cleanTitle(raw: string | undefined | null, fallback = "the parcel"): string {
  const one = (raw ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return one ? one.slice(0, 80) : fallback;
}

/** The moment the merchant approved the case (the request to the customer "went out"), else the last change. */
function approvedAtMs(c: CaseRecord): number {
  for (let i = c.trace.length - 1; i >= 0; i--) {
    const step = c.trace[i];
    if (step.step.startsWith("Merchant approved the case")) {
      const t = parseTime(step.at);
      if (t !== null) return t;
    }
  }
  return parseTime(c.updatedAt) ?? parseTime(c.createdAt) ?? 0;
}

function carrierLabelOf(c: CaseRecord): string | null {
  const carrier = c.order?.carrier;
  return carrier ? getCarrierRulesDetailed(carrier).label : null;
}

function toCents(eur: number): number {
  return Math.round(eur * 100);
}

interface Evaluated {
  item: SweepItem;
  /** Sort keys. Hours from the case's own clock to its deadline. */
  deadlineHours: number | null;
  cents: number;
  waitedMs: number;
}

function evaluate(c: CaseRecord, now: Date, s: SweepSettings): Evaluated | null {
  if (!OPEN_STATUSES.includes(c.status)) return null;

  // A recorded run is read as of its recording, like everywhere else in the app (caseClock): its
  // deadlines are those of that day, so they never turn "passed" a few days after the recording.
  const clock = c.recorded ? new Date(c.createdAt) : now;
  const clockMs = clock.getTime();
  const claim = c.claim;
  const carrierLabel = carrierLabelOf(c);
  const filed = Boolean(c.claimFiledAt);
  const reasons: (SweepReason & { order: number })[] = [];
  const add = (kind: SweepReasonKind, order: number, text: string) => reasons.push({ kind, order, text });

  // --- deadlines ----------------------------------------------------------------------
  // A claim the agent decided not to make has no deadline to chase. A claim that is not eligible
  // YET (blurry photos, a missing order) keeps its deadline in computeClaim, because the clock
  // runs while the customer answers: that one stays. A claim that can never work has none (null).
  // Once the merchant marked it filed, nothing is left to be late for.
  const claimIntended = claim !== null && (claim.eligible ? c.decision?.carrierClaim !== false : true);
  const claimMs = claimIntended ? parseTime(claim.claimDeadline) : null;
  const reserveMs = claimIntended ? parseTime(claim.reserveDeadline) : null;
  const candidates: { kind: "claim" | "reserve"; ms: number; binding: boolean }[] = [];
  if (!filed) {
    if (claimMs !== null && claimMs > clockMs) candidates.push({ kind: "claim", ms: claimMs, binding: true });
    // As on the Insights timeline: the reserve window is its own deadline only when it closes at
    // another moment than the claim (Colissimo), and only while it is still open.
    if (
      reserveMs !== null &&
      reserveMs > clockMs &&
      (claimMs === null || claimMs <= clockMs || Math.abs(reserveMs - claimMs) > 60_000) &&
      c.order
    ) {
      candidates.push({
        kind: "reserve",
        ms: reserveMs,
        binding: getCarrierRulesDetailed(c.order.carrier).reserveDeadlineBinding,
      });
    }
  }
  candidates.sort((a, b) => a.ms - b.ms);
  const first = candidates[0];
  const deadline: SweepDeadline | null = first
    ? { kind: first.kind, at: new Date(first.ms).toISOString(), hoursLeft: (first.ms - clockMs) / HOUR_MS, binding: first.binding }
    : null;
  const withinHorizon = deadline !== null && deadline.hoursLeft <= s.horizonHours;
  for (const d of candidates) {
    const hoursLeft = (d.ms - clockMs) / HOUR_MS;
    if (hoursLeft > s.horizonHours) continue;
    const when = formatMoment(new Date(d.ms).toISOString());
    if (d.kind === "claim") {
      // An absolute moment, never "in 17 h": the sweep is stored and read up to a day later, and the
      // panel's own countdown carries the time left.
      add("claim_deadline", 0, `The claim deadline${carrierLabel ? ` of ${carrierLabel}` : ""} closes ${when}.`);
    } else {
      const hours = c.order ? getCarrierRulesDetailed(c.order.carrier).reserveDeadlineHours : null;
      add(
        "reserve_window",
        1,
        `The ${hours === null ? "" : `${hours} h `}reserve window${carrierLabel ? ` of ${carrierLabel}` : ""} closes ${when}${
          d.binding ? "" : " (a prudential window, not confirmed for this carrier)"
        }.`,
      );
    }
  }

  // --- money --------------------------------------------------------------------------
  const claimOpen = claimIsOpen(c) && !filed && (claimMs === null || claimMs > clockMs);
  const amountEur = claimOpen && claim ? claim.maxCompensationEur : 0;
  // The moment the amount stops being claimable: the panel hides the amount when it passes, whichever
  // deadline (a reserve window can come first) is the one it counts down to.
  const claimDeadlineAt = claimOpen && claimMs !== null ? new Date(claimMs).toISOString() : null;

  // --- the customer is the one we wait for ----------------------------------------------
  let waiting: SweepItem["waiting"] = null;
  let waitedMs = 0;
  if (c.status === "approved") {
    const availability = followUpAvailability(c);
    if (availability.available) {
      const since = approvedAtMs(c);
      waitedMs = Math.max(0, clockMs - since);
      waiting = { since: new Date(since).toISOString(), hours: waitedMs / HOUR_MS, missing: availability.missing };
      if (waiting.hours >= s.waitingHours) {
        add(
          "waiting_on_customer",
          2,
          `Waiting for the customer: the request was approved ${formatMoment(waiting.since)} and no reply was added to the case (Gilmend cannot see your inbox, only what you add).`,
        );
      }
    }
  }

  // --- the merchant is the one we wait for ----------------------------------------------
  if (c.status === "approved" && claimOpen) {
    add(
      "claim_not_filed",
      3,
      `Approved, but the claim is not marked as filed. Gilmend files nothing: send it to ${carrierLabel ?? "the carrier"}, then mark it as filed.`,
    );
  }
  if (c.status === "new") {
    const idleMs = clockMs - (parseTime(c.updatedAt) ?? parseTime(c.createdAt) ?? clockMs);
    if (idleMs >= s.stuckHours * HOUR_MS) {
      add(
        "stuck_run",
        4,
        `The agent run did not finish (nothing since ${formatMoment(new Date(clockMs - idleMs).toISOString())}): the report is stored, a person has to look at it.`,
      );
    }
  }
  if (c.status === "needs_review") {
    if (c.decision === null) {
      add("needs_human", 4, "The agent produced no decision: a person has to look at this case.");
    } else if (c.decision.needsHuman) {
      add("needs_human", 4, "The agent flagged this case for a human before anything is approved.");
    } else {
      add("awaiting_click", 5, "Waiting for your click: approve, edit or reject.");
    }
  }

  if (reasons.length === 0) return null;
  reasons.sort((a, b) => a.order - b.order);

  const kinds = new Set(reasons.map((r) => r.kind));
  const action: SweepAction = kinds.has("waiting_on_customer")
    ? "nudge_customer"
    : kinds.has("claim_not_filed")
      ? "file_claim"
      : c.status === "new"
        ? "check_failed_run"
        : "review_case";

  const item: SweepItem = {
    rank: 0,
    caseId: c.id,
    orderId: orderLabel(c),
    itemTitle: cleanTitle(claim?.basis?.itemTitle ?? c.assessment?.item ?? c.order?.lineItems[0]?.title),
    carrier: c.order?.carrier ?? null,
    carrierLabel,
    status: c.status,
    caseEngine: c.engine,
    recordedOn: c.recorded?.recordedOn ?? null,
    readAt: clock.toISOString(),
    action,
    reasons: reasons.map(({ kind, text }) => ({ kind, text })),
    deadline,
    withinHorizon,
    amountEur,
    claimDeadlineAt,
    waiting,
    simulatedReply: hasSimulatedReply(c),
    language: /^[a-z]{2}$/.test(c.report.language) ? c.report.language : "en",
    nudge: null,
  };
  return { item, deadlineHours: deadline ? deadline.hoursLeft : null, cents: toCents(amountEur), waitedMs };
}

/** The ranking rules above, as a comparator. */
function byPriority(a: Evaluated, b: Evaluated): number {
  const da = a.deadlineHours ?? Number.POSITIVE_INFINITY;
  const db = b.deadlineHours ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da < db ? -1 : 1;
  if (a.cents !== b.cents) return b.cents - a.cents;
  const actions = ACTION_ORDER[a.item.action] - ACTION_ORDER[b.item.action];
  if (actions !== 0) return actions;
  if (a.waitedMs !== b.waitedMs) return b.waitedMs - a.waitedMs;
  return a.item.caseId < b.item.caseId ? -1 : a.item.caseId > b.item.caseId ? 1 : 0;
}

/**
 * What is due, ranked. Pure: the same cases, the same `now` and the same options always give the
 * same plan. Recorded showcase runs are left out unless `includeRecorded` is set.
 */
export function buildSweepPlan(all: CaseRecord[], now: Date, options: PlanOptions = {}): SweepPlan {
  if (Number.isNaN(now.getTime())) throw new TypeError("buildSweepPlan: `now` is an invalid Date");
  const defaults = sweepSettings();
  const s: SweepSettings = {
    horizonHours: options.horizonHours ?? defaults.horizonHours,
    waitingHours: options.waitingHours ?? defaults.waitingHours,
    stuckHours: options.stuckHours ?? defaults.stuckHours,
  };
  const includeRecorded = options.includeRecorded === true;
  const counted = includeRecorded ? all : all.filter((c) => !c.recorded);

  const evaluated = counted
    .map((c) => evaluate(c, now, s))
    .filter((e): e is Evaluated => e !== null)
    .sort(byPriority);
  const items = evaluated.map((e, i) => ({ ...e.item, rank: i + 1 }));

  const has = (item: SweepItem, kind: SweepReasonKind) => item.reasons.some((r) => r.kind === kind);
  const counts: SweepCounts = {
    cases: counted.length,
    open: counted.filter((c) => OPEN_STATUSES.includes(c.status)).length,
    due: items.length,
    closingSoon: items.filter((i) => i.withinHorizon).length,
    waitingOnCustomer: items.filter((i) => has(i, "waiting_on_customer")).length,
    claimsNotFiled: items.filter((i) => has(i, "claim_not_filed")).length,
    needHuman: items.filter((i) => has(i, "needs_human") || has(i, "stuck_run")).length,
  };
  // Cents, like the header counter; a simulated reply is a rehearsal and never counts as money.
  const cents = items.filter((i) => !i.simulatedReply).reduce((sum, i) => sum + toCents(i.amountEur), 0);

  return {
    includeRecorded,
    horizonHours: s.horizonHours,
    waitingHours: s.waitingHours,
    counts,
    moneyAtStakeEur: cents / 100,
    items: items.slice(0, MAX_LISTED_ITEMS),
    moreItems: Math.max(0, items.length - MAX_LISTED_ITEMS),
  };
}
