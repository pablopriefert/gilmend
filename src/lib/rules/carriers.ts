import carriersFile from "../../../data/carriers.json";
import type {
  CarrierId,
  CarrierRules,
  ClaimBasis,
  ClaimComputation,
  DamageAssessment,
  Order,
  OrderLineItem,
} from "../types";
import {
  validateCarrierRulesFile,
  type CarrierRulesDetailed,
  type Compensation,
  type CompensationVariant,
  type DomesticScope,
  type RuleFigure,
} from "./schema";

// Deterministic carrier rules and claim maths. No model is involved anywhere in this file:
// the model only reads the photos; the amounts and the deadlines come from here, so they
// can be audited, tested and quoted in the claim PDF.

export type { CarrierRulesDetailed, RuleFigure } from "./schema";

/**
 * Below this indemnity the time spent filing is probably not worth it (research notes of
 * 2026-10-22, section 5.3 C). It is advice, not eligibility: computeClaim still says
 * "eligible"; the agent decides with isWorthFiling().
 */
export const MIN_WORTHWHILE_CLAIM_EUR = 15;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Validated once at import: a broken hand edit of data/carriers.json fails here, loudly.
const RULES = validateCarrierRulesFile(carriersFile);

/** Extra facts about the delivery that the order does not carry. */
export interface ClaimOptions {
  /**
   * Did the customer refuse the parcel at delivery? Mondial Relay rejects claims for a
   * damaged parcel that was accepted. undefined or null means "unknown": the claim stays
   * possible but carries a warning.
   */
  parcelRefusedAtDelivery?: boolean | null;
}

/** Dated, sourced rules for a carrier, in the shared contract shape. */
export function getCarrierRules(carrier: CarrierId): CarrierRules {
  return getCarrierRulesDetailed(carrier);
}

/** Same rules with service variants and the status of every figure (for the UI and the PDF). */
export function getCarrierRulesDetailed(carrier: CarrierId): CarrierRulesDetailed {
  const rules = RULES.carriers[carrier];
  if (!rules) throw new Error(`Unknown carrier "${String(carrier)}"`);
  // A copy, so a caller cannot change the rules for everybody else.
  return structuredClone(rules);
}

/** Date of the last human review of data/carriers.json (YYYY-MM-DD). */
export function rulesLastReviewed(): string {
  return RULES.lastReviewed;
}

/** Figures that are not confirmed in a current official source: show them to the merchant. */
export function figuresNeedingCheck(carrier: CarrierId): RuleFigure[] {
  return getCarrierRulesDetailed(carrier).figures.filter((f) => f.status !== "verified");
}

/** Whether a computed claim is worth the filing effort (advice only). */
export function isWorthFiling(claim: ClaimComputation): boolean {
  return claim.eligible && claim.maxCompensationEur >= MIN_WORTHWHILE_CLAIM_EUR;
}

// ---------------------------------------------------------------------------------------
// Helpers

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function eur(n: number): string {
  return `${round2(n).toFixed(2)} EUR`;
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function stamp(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

function hours(ms: number): string {
  const h = ms / HOUR_MS;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP_WORDS = new Set(["the", "and", "for", "with", "set", "pack", "pour", "avec", "des", "les"]);

function tokens(s: string): string[] {
  return normalise(s)
    .split(" ")
    // Strip a plural "s" so "vases" matches "vase".
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t))
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

interface MatchedItem {
  item: OrderLineItem;
  /** "only" = the order has a single line; "name" = matched by words; "fallback" = guessed. */
  how: "only" | "name" | "ambiguous" | "fallback";
}

/**
 * Finds the order line the model talks about. When the match is not clear we take the
 * cheapest candidate: the figure is a ceiling, and overstating a claim to a carrier is
 * worse than understating it.
 */
function matchLineItem(items: OrderLineItem[], described: string): MatchedItem | null {
  const priced = items.filter((i) => Number.isFinite(i.unitPrice) && i.unitPrice > 0);
  if (priced.length === 0) return null;
  const cheapest = (list: OrderLineItem[]) => list.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a));
  if (items.length === 1) return { item: priced[0], how: "only" };

  const wanted = new Set(tokens(described));
  const scored = priced.map((item) => ({
    item,
    score: tokens(item.title).filter((t) => wanted.has(t)).length,
  }));
  const best = Math.max(...scored.map((s) => s.score));
  if (best === 0) return { item: cheapest(priced), how: "fallback" };
  const top = scored.filter((s) => s.score === best).map((s) => s.item);
  return top.length === 1 ? { item: top[0], how: "name" } : { item: cheapest(top), how: "ambiguous" };
}

function selectCompensation(
  rules: CarrierRulesDetailed,
  order: Order,
): { compensation: Compensation; variant: CompensationVariant | null } {
  const service = (order.service ?? "").toLowerCase();
  for (const variant of rules.compensationVariants) {
    const { serviceIncludes = [], serviceExcludes = [], itemPattern } = variant.when;
    const byService =
      serviceIncludes.some((s) => service.includes(s.toLowerCase())) &&
      !serviceExcludes.some((s) => service.includes(s.toLowerCase()));
    const byItem = itemPattern
      ? order.lineItems.some((li) => new RegExp(itemPattern, "i").test(li.title))
      : false;
    if (byService || byItem) return { compensation: variant.compensation, variant };
  }
  return { compensation: rules.compensation, variant: null };
}

function isDomestic(country: string | undefined, scope: DomesticScope): boolean {
  const c = normalise(country ?? "");
  return c === "" || scope.aliases.some((alias) => normalise(alias) === c);
}

/**
 * Merchant-only warning when the photos suggest weak packaging. Whether the carrier's terms
 * exclude it is stated only for carriers whose notes in data/carriers.json record such a
 * clause (Colissimo and Chronopost today); for the others we say we found none.
 */
export const PACKAGING_WARNING_PREFIX =
  "Warning: the photos suggest the packaging may be judged inadequate; the carrier may refuse compensation on that ground.";

function packagingWarning(rules: CarrierRulesDetailed): string {
  const clauseRecorded = rules.notes.some((n) => /packaging/i.test(n));
  const basis = clauseRecorded
    ? `The ${rules.label} terms we read exclude unsuitable packaging.`
    : `Our notes on ${rules.label} record no packaging exclusion, so this is a precaution.`;
  return `${PACKAGING_WARNING_PREFIX} ${basis} Check the packing before filing.`;
}

// ---------------------------------------------------------------------------------------

/**
 * Deterministic claim maths: eligibility, maximum compensation and deadlines.
 * `reportReceivedAt` is the ISO date-time the customer reported the damage; `now` is
 * injected so tests are reproducible. Never calls a model.
 *
 * Conventions:
 *  - a deadline is inclusive: acting exactly on it is still in time;
 *  - deadlines use calendar hours and days, public holidays are not skipped (L133-3 and
 *    Mondial Relay skip them), so a computed deadline is never later than the real one;
 *  - `reasons` mixes blockers and facts. A line starting with "Warning:" or "Note:" is
 *    advisory and does not change `eligible`; other lines are facts or blockers;
 *  - when `eligible` is false, `maxCompensationEur` is 0. `claimDeadline` and `daysLeft`
 *    are null when the claim can never work (no damage, carrier not at fault, deadline
 *    passed...) but kept when only evidence is missing (blurry photos, unknown weight),
 *    because the clock keeps running while the merchant fixes that.
 */
export function computeClaim(
  order: Order,
  assessment: DamageAssessment,
  reportReceivedAt: string,
  now: Date,
  options: ClaimOptions = {},
): ClaimComputation {
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) throw new TypeError("computeClaim: `now` is an invalid Date");

  const rules = getCarrierRulesDetailed(order.carrier);
  const blockers: string[] = [];
  const facts: string[] = [];
  const advice: string[] = [];
  // permanent: the claim can never work. late: a deadline has passed. fixable: data or
  // evidence is missing and may be supplied.
  let permanent = false;
  let late = false;

  const blockPermanent = (msg: string) => {
    permanent = true;
    blockers.push(msg);
  };
  const blockLate = (msg: string) => {
    late = true;
    blockers.push(msg);
  };
  const blockFixable = (msg: string) => {
    blockers.push(msg);
  };

  // --- scope -------------------------------------------------------------------------
  if ((order.currency ?? "").toUpperCase() !== "EUR") {
    blockPermanent(
      `The order is in ${order.currency || "an unknown currency"}; carrier compensation grids are in EUR and no conversion is applied, so a person must handle this claim.`,
    );
  }
  if (!isDomestic(order.shippingAddress?.country, rules.domestic)) {
    blockPermanent(
      `The parcel went to ${order.shippingAddress.country}; the rules in this file cover shipments within ${rules.domestic.name} only (international terms and deadlines differ), so a person must handle this claim.`,
    );
  }

  // --- damage, fault, packaging --------------------------------------------------------
  if (assessment.severity === "none") {
    blockPermanent(
      assessment.damageType === "crushed_packaging"
        ? "Only the outer packaging is crushed and the product itself is intact. Carriers compensate damaged goods, not a damaged box, so there is nothing to claim."
        : "The photos show no damage to the goods, so there is nothing to claim.",
    );
  } else if (assessment.damageType === "unclear") {
    blockFixable("The type of damage is unclear from the photos; ask the customer for clearer photos before claiming.");
  } else {
    facts.push(
      `Damage to the goods is documented: ${assessment.damageType.replace(/_/g, " ")}, severity ${assessment.severity}.`,
    );
  }

  if (assessment.photoQuality !== "ok") {
    blockFixable(
      `The photos are ${assessment.photoQuality}: the damage cannot be documented for the carrier. Ask the customer for new photos.`,
    );
  }

  if (!assessment.carrierLikelyAtFault) {
    blockPermanent(
      "The damage does not look caused by the carrier (for example a defect or a customer handling issue), so a carrier claim would be rejected.",
    );
  } else if (assessment.severity !== "none") {
    facts.push("The carrier is the likely cause of the damage.");
  }

  if (assessment.packagingAdequate === false) {
    // Not a blocker (27 Oct 2026). On the same broken-vase photos Muse said "inadequate" on two of
    // the three real runs recorded before this change (crumpled paper and open flaps, on a photo
    // taken AFTER the box was opened; a fourth run, after it, said "adequate"), and each time a
    // 52.90 EUR claim disappeared on one uncertain reading. The
    // reading is a model's opinion about a box it cannot touch, and whether the packing was
    // suitable is the carrier's call, not ours. So the claim stays computed, carries this
    // merchant-only warning, and the guardrails send the case to a human (guardrails.ts).
    // It must never reach the carrier: the PDF and the e-mail are written from `basis`, not
    // from these reasons.
    advice.push(packagingWarning(rules));
  } else if (assessment.packagingAdequate === null) {
    advice.push(
      "Warning: the photos do not show whether the packaging was adequate; the carrier may refuse compensation if it was not.",
    );
  }

  // --- deadlines -----------------------------------------------------------------------
  const deliveredMs = parseTime(order.deliveredAt);
  const reportMs = parseTime(reportReceivedAt);
  let claimDeadlineMs: number | null = null;
  let reserveDeadlineMs: number | null = null;

  if (deliveredMs === null) {
    permanent = true;
    blockers.push(
      "The order has no valid delivery date (the parcel is not marked as delivered), so deadlines cannot be computed and no damage claim can be filed yet.",
    );
  } else {
    reserveDeadlineMs = deliveredMs + rules.reserveDeadlineHours * HOUR_MS;
    let claimBaseMs = deliveredMs;
    if (rules.claimDeadlineFrom === "shipment") {
      // The order has no pick-up date; the order date is earlier, hence the safe side.
      const createdMs = parseTime(order.createdAt);
      if (createdMs === null) {
        advice.push("Warning: the order date is invalid, so the claim deadline is counted from delivery instead of shipment.");
      } else {
        claimBaseMs = createdMs;
      }
    }
    claimDeadlineMs = claimBaseMs + rules.claimDeadlineDays * DAY_MS;

    if (nowMs > claimDeadlineMs) {
      blockLate(
        `The claim deadline of ${rules.label} passed on ${stamp(claimDeadlineMs)} (${rules.claimDeadlineDays} day${rules.claimDeadlineDays === 1 ? "" : "s"} ${rules.claimDeadlineFrom === "delivery" ? "after delivery" : "after shipment"}), so a claim can no longer be filed.`,
      );
    }

    if (reportMs === null) {
      blockFixable("The report date is invalid, so it cannot be compared with the carrier's reserve window.");
    } else {
      const afterDeliveryMs = reportMs - deliveredMs;
      const windowMs = rules.reserveDeadlineHours * HOUR_MS;
      if (reportMs > reserveDeadlineMs) {
        if (rules.reserveDeadlineBinding) {
          blockLate(
            `The customer reported the damage ${hours(afterDeliveryMs)} h after delivery, after the ${rules.reserveDeadlineHours} h reserve window of ${rules.label} closed on ${stamp(reserveDeadlineMs)}. The carrier rejects such claims.`,
          );
        } else {
          // Colissimo: the window itself is not confirmed. GLS: it is the statutory one, whose
          // breach only lets the carrier presume an undamaged delivery (HGB § 438); say which.
          const confirmed = rules.figures.find((f) => f.key === "reserveDeadlineHours")?.status === "verified";
          const why = confirmed
            ? `a statutory window: a late report weakens the claim for ${rules.label} without ending it`
            : `not confirmed for ${rules.label}`;
          advice.push(
            `Warning: the customer reported the damage ${hours(afterDeliveryMs)} h after delivery, beyond the ${rules.reserveDeadlineHours} h prudential reserve window (${why}); the carrier may contest the claim.`,
          );
        }
      } else if (afterDeliveryMs >= 0) {
        facts.push(
          `The customer reported the damage ${hours(afterDeliveryMs)} h after delivery, inside the ${hours(windowMs)} h reserve window (closes ${stamp(reserveDeadlineMs)}).`,
        );
      }
    }
  }

  // --- refusal at delivery (Mondial Relay) -----------------------------------------------
  if (rules.requiresRefusal) {
    if (options.parcelRefusedAtDelivery === false) {
      blockPermanent(
        `${rules.label} only accepts claims for a damaged parcel that the recipient refused at delivery; this parcel was accepted, so the claim would be rejected.`,
      );
    } else if (options.parcelRefusedAtDelivery === true) {
      facts.push("The customer refused the parcel at delivery, as the carrier requires.");
    } else {
      advice.push(
        `Warning: ${rules.label} only accepts claims when the recipient refused the damaged parcel at delivery; confirm this with the customer before filing.`,
      );
    }
  }

  // --- compensation ----------------------------------------------------------------------
  const { compensation, variant } = selectCompensation(rules, order);
  let computedMax = 0;
  let basis: ClaimBasis | undefined;
  const matched = matchLineItem(order.lineItems ?? [], assessment.item);

  if (!matched) {
    blockFixable("The order has no priced item, so the value of the damaged goods is unknown.");
  } else if (compensation.perKgEur !== undefined && !(order.weightKg > 0)) {
    blockFixable(
      `The parcel weight is ${Number.isFinite(order.weightKg) ? `${order.weightKg} kg` : "missing"} and ${variant ? variant.label : rules.label} pays per kilogram, so the indemnity cannot be computed. Check the weight on the shipping label.`,
    );
  } else {
    const itemValue = matched.item.unitPrice;
    const terms: string[] = [`item value ${eur(itemValue)}`];
    let ceiling = itemValue;
    if (compensation.perKgEur !== undefined) {
      const byWeight = compensation.perKgEur * order.weightKg;
      terms.push(`${compensation.perKgEur} EUR/kg x ${order.weightKg} kg = ${eur(byWeight)}`);
      ceiling = Math.min(ceiling, byWeight);
    }
    if (compensation.flatEur !== undefined) {
      terms.push(`${eur(compensation.flatEur)} per parcel`);
      ceiling = Math.min(ceiling, compensation.flatEur);
    }
    terms.push(`cap ${eur(compensation.capEur)}`);
    ceiling = Math.min(ceiling, compensation.capEur);
    computedMax = round2(ceiling);
    basis = {
      termsLabel: variant ? variant.label : rules.label,
      itemTitle: matched.item.title,
      itemValueEur: itemValue,
      weightKg: order.weightKg,
      ...(compensation.perKgEur !== undefined ? { perKgEur: compensation.perKgEur } : {}),
      ...(compensation.flatEur !== undefined ? { flatEur: compensation.flatEur } : {}),
      capEur: compensation.capEur,
    };

    const unitNote =
      matched.item.quantity > 1 ? `; one unit counted, the order has ${matched.item.quantity}` : "";
    facts.push(
      `Maximum compensation: min(${terms.join(", ")}) = ${eur(computedMax)} under ${variant ? variant.label : rules.label} terms${unitNote}.`,
    );
    if (matched.how === "ambiguous") {
      advice.push(
        `Warning: "${assessment.item}" matches several order lines; the cheapest one (${matched.item.title}) is used. Confirm the damaged item.`,
      );
    } else if (matched.how === "fallback") {
      advice.push(
        `Warning: "${assessment.item}" matches no order line; the cheapest line (${matched.item.title}) is used as a safe estimate. Confirm the damaged item.`,
      );
    }
  }

  const eligible = blockers.length === 0;

  // --- time left ------------------------------------------------------------------------
  // `openUntilMs` is the claim deadline while a claim can still work, otherwise null.
  const openUntilMs = !permanent && !late ? claimDeadlineMs : null;
  const claimDeadline = openUntilMs !== null ? new Date(openUntilMs).toISOString() : null;
  const daysLeft = openUntilMs !== null ? Math.floor((openUntilMs - nowMs) / DAY_MS) : null;
  const reserveDeadline =
    reserveDeadlineMs !== null && !permanent ? new Date(reserveDeadlineMs).toISOString() : null;

  if (openUntilMs !== null && daysLeft !== null) {
    if (openUntilMs - nowMs < DAY_MS) {
      advice.push(`Warning: less than 24 h left to file (deadline ${stamp(openUntilMs)}); send the claim today.`);
    } else {
      facts.push(`The claim must be filed by ${stamp(openUntilMs)} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left).`);
    }
  }

  if (eligible && rules.compensationCaveat) advice.push(`Note: ${rules.compensationCaveat}`);
  if (eligible && computedMax < MIN_WORTHWHILE_CLAIM_EUR) {
    advice.push(
      `Note: the maximum compensation is below ${eur(MIN_WORTHWHILE_CLAIM_EUR)}; the filing effort probably costs more than it recovers.`,
    );
  }

  return {
    eligible,
    reasons: eligible ? [...facts, ...advice] : [...blockers, ...advice],
    maxCompensationEur: eligible ? computedMax : 0,
    claimDeadline,
    reserveDeadline,
    daysLeft,
    ...(eligible && basis ? { basis } : {}),
  };
}
