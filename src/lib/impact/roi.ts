import { computeClaim, getCarrierRulesDetailed } from "../rules/carriers";
import type { CarrierId, DamageAssessment, Order } from "../types";
import { windowLabel } from "./insights";
import type { MeasuredTime } from "./measured-time";

// The ROI calculator behind /impact (27 Oct 2026): what damaged parcels cost a merchant in a year,
// how much carrier compensation is on the table, how much of it a late claim loses, and the time
// a case takes by hand and with Gilmend.
//
// The rule it follows: nothing here is a statistic. Every input is either the merchant's own
// figure or a labelled assumption (FIELDS says which, and the page prints the label next to the
// field). The only things not typed in are
//  - the carrier amounts and deadlines, which come from the same `computeClaim` that prepares real
//    claims (data/carriers.json, dated and sourced), run on a synthetic order built from the
//    inputs, never re-implemented here;
//  - the agent's time per case, which is measured on the recorded runs (measured-time.ts).
// The result is a ceiling ("up to"), like the claim amounts of the app: it is not a promise that
// a carrier pays.

export type FieldKey =
  | "ordersPerMonth"
  | "damageRatePct"
  | "avgOrderValueEur"
  | "avgWeightKg"
  | "shareColissimoPct"
  | "shareMondialRelayPct"
  | "shareChronopostPct"
  | "qualifyingSharePct"
  | "mondialRelayRefusedPct"
  | "customerReportHours"
  | "manualFilingDelayDays"
  | "gilmendApprovalHours"
  | "manualMinutesPerCase"
  | "reviewMinutesPerCase";

export type RoiInputs = Record<FieldKey, number>;

export type FieldGroup = "shop" | "carriers" | "claims" | "time";

export interface FieldMeta {
  key: FieldKey;
  group: FieldGroup;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  /**
   * yours: a figure about the merchant's shop that only they know; the default is an example.
   * assumption: a modelling choice that nobody measured for this merchant; the default is ours.
   */
  kind: "yours" | "assumption";
  /** What the field means and where the default comes from, in one or two sentences. */
  hint: string;
}

export const GROUP_LABEL: Record<FieldGroup, { title: string; description: string }> = {
  shop: { title: "Your shop", description: "Replace the examples with your own figures." },
  carriers: {
    title: "Carrier mix",
    description: "Share of your parcels shipped with each carrier. The three are rescaled to add up to 100%.",
  },
  claims: {
    title: "How claims go",
    description: "Where the carrier deadlines bite: when the customer writes in and when the claim is filed.",
  },
  time: { title: "Time per case", description: "What a damaged-parcel case costs you in minutes." },
};

export const FIELDS: readonly FieldMeta[] = [
  {
    key: "ordersPerMonth",
    group: "shop",
    label: "Orders per month",
    unit: "orders",
    min: 1,
    max: 1_000_000,
    step: 10,
    integer: true,
    kind: "yours",
    hint: "Example value, not a statistic. Use your last 12 months.",
  },
  {
    key: "damageRatePct",
    group: "shop",
    label: "Damage rate",
    unit: "% of orders",
    min: 0,
    max: 50,
    step: 0.1,
    kind: "assumption",
    hint: "Assumption, not a measured rate: we found no sourced per-parcel damage rate to cite (see the public record below). Count the damage reports you got over the last 12 months and divide by your orders.",
  },
  {
    key: "avgOrderValueEur",
    group: "shop",
    label: "Value of a damaged item",
    unit: "EUR",
    min: 1,
    max: 100_000,
    step: 1,
    kind: "yours",
    hint: "Example value. Carriers pay the value of the goods up to their cap, so a damaged item is counted at this value, one unit per parcel.",
  },
  {
    key: "avgWeightKg",
    group: "shop",
    label: "Parcel weight",
    unit: "kg",
    min: 0.05,
    max: 30,
    step: 0.1,
    kind: "yours",
    hint: "Example value. Colissimo pays per kilogram, so a light parcel is paid less than the value of its content.",
  },
  {
    key: "shareColissimoPct",
    group: "carriers",
    label: "Colissimo",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    kind: "yours",
    hint: "Example value.",
  },
  {
    key: "shareMondialRelayPct",
    group: "carriers",
    label: "Mondial Relay",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    kind: "yours",
    hint: "Example value. Mondial Relay only pays a parcel the customer refused at delivery: see the share refused, under How claims go.",
  },
  {
    key: "shareChronopostPct",
    group: "carriers",
    label: "Chronopost",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    kind: "yours",
    hint: "Example value.",
  },
  {
    key: "qualifyingSharePct",
    group: "claims",
    label: "Damaged parcels that qualify for a claim",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    kind: "assumption",
    hint: "Assumption. A claim needs the carrier at fault, damaged goods (not just a crushed box) and usable photos. Our recorded runs are scenarios chosen to show each case, so their share of claims is not a rate.",
  },
  {
    key: "mondialRelayRefusedPct",
    group: "claims",
    label: "Damaged Mondial Relay parcels refused at delivery",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    kind: "assumption",
    hint: "Assumption: we know of no rate. Mondial Relay pays nothing for a damaged parcel the customer accepted, so only this share of its qualifying claims counts. The report delay below is applied to all of them, refused ones included.",
  },
  {
    key: "customerReportHours",
    group: "claims",
    label: "Customer reports the damage after",
    unit: "h after delivery",
    min: 0,
    max: 720,
    step: 1,
    kind: "assumption",
    hint: "Assumption. Mondial Relay and Chronopost reject a report made after 72 h; the calculator applies that window to both ways of working.",
  },
  {
    key: "manualFilingDelayDays",
    group: "claims",
    label: "Claim filed by hand after the report",
    unit: "days",
    min: 0,
    max: 60,
    step: 0.5,
    kind: "assumption",
    hint: "Assumption, not a measured delay. How long a claim waits when a person does it between other jobs. Try 0 to see what a perfect manual process recovers.",
  },
  {
    key: "gilmendApprovalHours",
    group: "claims",
    label: "Claim filed with Gilmend after the report",
    unit: "h",
    min: 0,
    max: 720,
    step: 1,
    kind: "assumption",
    hint: "Assumption. Gilmend has the dossier ready within a minute, but nothing is sent without your click, and you file it with the carrier yourself.",
  },
  {
    key: "manualMinutesPerCase",
    group: "time",
    label: "Time per case by hand",
    unit: "min",
    min: 0,
    max: 600,
    step: 1,
    kind: "assumption",
    hint: "Assumption, not a measured time: find the order, read the photos, check the carrier's terms, write the claim and the reply. Replace it with your own.",
  },
  {
    key: "reviewMinutesPerCase",
    group: "time",
    label: "Your review time per case with Gilmend",
    unit: "min",
    min: 0,
    max: 600,
    step: 1,
    kind: "assumption",
    hint: "Assumption: read the decision and the outlines, check the draft, click Approve and file the claim. The agent's own time is measured, below.",
  },
];

export const DEFAULT_INPUTS: RoiInputs = {
  ordersPerMonth: 400,
  damageRatePct: 2,
  avgOrderValueEur: 60,
  avgWeightKg: 1.5,
  shareColissimoPct: 60,
  shareMondialRelayPct: 25,
  shareChronopostPct: 15,
  qualifyingSharePct: 70,
  mondialRelayRefusedPct: 20,
  customerReportHours: 24,
  manualFilingDelayDays: 4,
  gilmendApprovalHours: 12,
  manualMinutesPerCase: 20,
  reviewMinutesPerCase: 3,
};

export function fieldMeta(key: FieldKey): FieldMeta {
  const meta = FIELDS.find((f) => f.key === key);
  if (!meta) throw new Error(`Unknown ROI field "${key}"`);
  return meta;
}

// ---------------------------------------------------------------------------------------
// Validation

export type RawInputs = Record<FieldKey, string>;

export type Validation =
  | { ok: true; inputs: RoiInputs }
  | { ok: false; errors: Partial<Record<FieldKey, string>> };

/** The defaults as the strings a form holds. */
export function defaultRaw(): RawInputs {
  return Object.fromEntries(FIELDS.map((f) => [f.key, String(DEFAULT_INPUTS[f.key])])) as RawInputs;
}

function parseOne(raw: string, meta: FieldMeta): { value: number } | { error: string } {
  const text = raw.trim().replace(",", ".");
  if (text === "") return { error: "Enter a number." };
  // Number("1e3") is 1000 and Number("0x10") is 16: a plain decimal is what a person means here.
  if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) return { error: "Enter a plain number, for example 12 or 2.5." };
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: "Enter a number." };
  if (meta.integer && !Number.isInteger(value)) return { error: "Enter a whole number." };
  if (value < meta.min) return { error: `Must be at least ${meta.min}.` };
  if (value > meta.max) return { error: `Must be at most ${meta.max.toLocaleString("en-GB")}.` };
  return { value };
}

/** Parses the form's strings. Either every field is valid, or each bad field gets one message. */
export function validateRoiInputs(raw: RawInputs): Validation {
  const errors: Partial<Record<FieldKey, string>> = {};
  const values: Partial<RoiInputs> = {};
  for (const meta of FIELDS) {
    const parsed = parseOne(raw[meta.key] ?? "", meta);
    if ("error" in parsed) errors[meta.key] = parsed.error;
    else values[meta.key] = parsed.value;
  }
  if (Object.keys(errors).length === 0) {
    const v = values as RoiInputs;
    if (v.shareColissimoPct + v.shareMondialRelayPct + v.shareChronopostPct <= 0) {
      // Put the message on the first share so it appears next to a field the person can change.
      errors.shareColissimoPct = "At least one carrier needs a share above 0.";
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, inputs: values as RoiInputs };
}

// ---------------------------------------------------------------------------------------
// The synthetic claim: the real rule code, on an order built from the inputs

// Deadlines are counted in calendar hours and days from the delivery, so any fixed instant gives
// the same answer. A constant keeps the function pure and the tests reproducible.
const REFERENCE_DELIVERY = "2026-01-05T09:00:00.000Z";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const SERVICE: Record<CarrierId, string> = {
  colissimo: "Colissimo Domicile sans signature",
  mondial_relay: "Mondial Relay point relais",
  chronopost: "Chronopost standard",
  dhl_paket: "DHL Paket",
  gls: "GLS Paket",
};

/**
 * The carriers the calculator has a share input for: the three French ones. DHL Paket and GLS (28 Oct
 * 2026) have rules and claims but no input here: the calculator's defaults describe a French
 * merchant, and a share the merchant cannot set would be a guess.
 */
const ROI_CARRIERS: readonly CarrierId[] = ["mondial_relay", "chronopost", "colissimo"];

function syntheticOrder(carrier: CarrierId, inputs: RoiInputs): Order {
  const delivered = Date.parse(REFERENCE_DELIVERY);
  return {
    id: "#ROI",
    name: "Sample customer",
    email: "customer@example.com",
    // Colissimo counts its 12 months from the order date: three days before delivery here.
    createdAt: new Date(delivered - 3 * DAY_MS).toISOString(),
    deliveredAt: REFERENCE_DELIVERY,
    carrier,
    service: SERVICE[carrier],
    trackingNumber: "ROI0000000",
    weightKg: inputs.avgWeightKg,
    currency: "EUR",
    lineItems: [{ sku: "AVERAGE", title: "Average item", quantity: 1, unitPrice: inputs.avgOrderValueEur }],
    total: inputs.avgOrderValueEur,
    shippingAddress: { city: "Paris", country: "FR" },
  };
}

// A clear case of broken goods caused by the carrier with usable photos: the share of cases that
// look like this is the `qualifyingSharePct` input, so the claim itself is always the clean one.
const CLEAR_DAMAGE: DamageAssessment = {
  item: "Average item",
  damageType: "broken_product",
  severity: "major",
  carrierLikelyAtFault: true,
  packagingAdequate: true,
  evidenceNotes: [],
  photoQuality: "ok",
};

/**
 * Maximum compensation of one clear claim, when the customer reports `reportHours` after delivery
 * and the claim is filed `filedAfterHours` after that report. 0 when the rules refuse it.
 * `refusedAtDelivery` says whether the customer refused the parcel at the counter, which only
 * matters to a carrier that pays refused parcels alone (Mondial Relay). Calls the real
 * computeClaim: the amounts and the deadlines are the ones of the app.
 */
export function claimValueEur(
  carrier: CarrierId,
  inputs: RoiInputs,
  reportHours: number,
  filedAfterHours: number,
  refusedAtDelivery = true,
): number {
  const delivered = Date.parse(REFERENCE_DELIVERY);
  const reportAt = new Date(delivered + reportHours * HOUR_MS);
  const now = new Date(reportAt.getTime() + filedAfterHours * HOUR_MS);
  const claim = computeClaim(syntheticOrder(carrier, inputs), CLEAR_DAMAGE, reportAt.toISOString(), now, {
    parcelRefusedAtDelivery: refusedAtDelivery,
  });
  return claim.eligible ? claim.maxCompensationEur : 0;
}

/**
 * The share (0 to 1) of a carrier's qualifying claims that its rules can pay: the share refused at
 * delivery for a carrier that pays refused parcels alone, 1 for the others. Read from the rules,
 * not from a carrier name.
 */
export function payableShare(carrier: CarrierId, inputs: RoiInputs): number {
  return getCarrierRulesDetailed(carrier).requiresRefusal ? inputs.mondialRelayRefusedPct / 100 : 1;
}

/**
 * Expected compensation of one qualifying claim: the claim of a refused parcel and the claim of
 * an accepted one (0 where the carrier refuses it), weighted by the share refused at delivery.
 * For a carrier without that rule the two are equal and the weight changes nothing.
 */
export function expectedClaimValueEur(
  carrier: CarrierId,
  inputs: RoiInputs,
  reportHours: number,
  filedAfterHours: number,
): number {
  const refused = claimValueEur(carrier, inputs, reportHours, filedAfterHours, true);
  if (!getCarrierRulesDetailed(carrier).requiresRefusal) return refused;
  const accepted = claimValueEur(carrier, inputs, reportHours, filedAfterHours, false);
  const p = payableShare(carrier, inputs);
  return p * refused + (1 - p) * accepted;
}

// ---------------------------------------------------------------------------------------
// Result

/** Why a carrier's claims are worth less by hand than with Gilmend. */
export type HandOutcome =
  /** Filed in time by hand too: nothing is lost. */
  | "in_time"
  /** The window closes before a claim filed by hand: money lost to the deadline. */
  | "late_filing"
  /** The customer reported after the window: no way of working recovers it (even filed at once). */
  | "late_report"
  /** The carrier pays refused parcels alone and none is assumed refused: nothing to claim there. */
  | "refusal_needed"
  /** Nothing to claim at all (no parcels, or a 0 share). */
  | "none";

export interface CarrierRoi {
  carrier: CarrierId;
  /** Share after rescaling to 100%, 0 to 100. */
  sharePct: number;
  damagedPerYear: number;
  /** Damaged parcels that qualify for a claim. */
  claimsPerYear: number;
  /**
   * Share (0 to 100) of the qualifying claims the carrier's rules can pay: the share refused at
   * delivery for Mondial Relay, 100 for the others. The per-claim amounts below already count it.
   */
  payableSharePct: number;
  /**
   * Maximum of one claim the carrier pays (a parcel refused at delivery, for Mondial Relay), filed
   * the moment the customer reports. The three amounts below are weighted by `payableSharePct`
   * instead: they are the expected value of one qualifying claim.
   */
  perClaimIfPaidEur: number;
  /** Maximum of one claim filed the moment the customer reports: what the rules allow at best. */
  perClaimAvailableEur: number;
  /** Maximum of one claim filed within `gilmendApprovalHours` of the report. */
  perClaimWithGilmendEur: number;
  /** Maximum of one claim filed `manualFilingDelayDays` after the report. */
  perClaimByHandEur: number;
  /** Up to this much a year if every qualifying claim were filed at once. */
  availableEur: number;
  /** Up to this much with Gilmend, per year. */
  withGilmendEur: number;
  /** Up to this much by hand, per year. */
  byHandEur: number;
  /** What the deadline costs by hand: available minus by hand, never negative. */
  lostByHandEur: number;
  /** What the deadline costs with Gilmend (non-zero only if the approval is slower than the window). */
  lostWithGilmendEur: number;
  outcome: HandOutcome;
  /** "3 days after delivery", from the rules. */
  windowLabel: string;
}

export interface TimeRoi {
  manualMinutesPerCase: number;
  /** Measured on the recorded runs, null when there is none to read. */
  agentSecondsPerCase: number | null;
  reviewMinutesPerCase: number;
  gilmendMinutesPerCase: number;
  savedMinutesPerCase: number;
  manualHoursPerYear: number;
  gilmendHoursPerYear: number;
  savedHoursPerYear: number;
}

export interface RoiResult {
  inputs: RoiInputs;
  damagedPerYear: number;
  /** Value of the damaged goods per year: what reshipping or refunding costs before any claim. */
  goodsValueEur: number;
  claimsPerYear: number;
  carriers: CarrierRoi[];
  /** Up to this much of carrier compensation per year if every qualifying claim were filed at once. */
  availableEur: number;
  /** Up to this much per year with Gilmend (claims filed within the approval time). */
  withGilmendEur: number;
  /** Up to this much per year by hand (claims filed after the manual delay). */
  byHandEur: number;
  /** Lost to deadlines by hand: available minus by hand. */
  lostByHandEur: number;
  lostWithGilmendEur: number;
  /** With Gilmend minus by hand: what the change recovers, negative when the inputs say it recovers less. */
  gainEur: number;
  time: TimeRoi;
}

function cents(eur: number): number {
  return Math.round(eur * 100) / 100;
}

function pickShare(inputs: RoiInputs, carrier: CarrierId): number {
  switch (carrier) {
    case "colissimo":
      return inputs.shareColissimoPct;
    case "mondial_relay":
      return inputs.shareMondialRelayPct;
    case "chronopost":
      return inputs.shareChronopostPct;
    case "dhl_paket":
    case "gls":
      return 0;
  }
}

/**
 * Yearly figures from validated inputs. `measured` is the agent's time from the recorded runs
 * (see measureAgentTime); without it the agent's own seconds are left out and `agentSecondsPerCase`
 * is null, so the page can say the time was not measured.
 */
export function computeRoi(inputs: RoiInputs, measured: MeasuredTime | null): RoiResult {
  const damagedPerYear = inputs.ordersPerMonth * 12 * (inputs.damageRatePct / 100);
  const claimsPerYear = damagedPerYear * (inputs.qualifyingSharePct / 100);
  const totalShare = ROI_CARRIERS.reduce((sum, c) => sum + pickShare(inputs, c), 0);

  const carriers = ROI_CARRIERS.map((carrier): CarrierRoi => {
    const sharePct = totalShare > 0 ? (pickShare(inputs, carrier) / totalShare) * 100 : 0;
    const carrierDamaged = (damagedPerYear * sharePct) / 100;
    const carrierClaims = (claimsPerYear * sharePct) / 100;
    const payable = payableShare(carrier, inputs);
    const perAvailable = expectedClaimValueEur(carrier, inputs, inputs.customerReportHours, 0);
    const perWith = expectedClaimValueEur(carrier, inputs, inputs.customerReportHours, inputs.gilmendApprovalHours);
    const perHand = expectedClaimValueEur(
      carrier,
      inputs,
      inputs.customerReportHours,
      inputs.manualFilingDelayDays * 24,
    );
    const availableEur = cents(carrierClaims * perAvailable);
    const withGilmendEur = cents(carrierClaims * perWith);
    const byHandEur = cents(carrierClaims * perHand);
    let outcome: HandOutcome;
    if (carrierClaims === 0) outcome = "none";
    else if (payable === 0) outcome = "refusal_needed";
    else if (perAvailable === 0) outcome = "late_report";
    else if (perHand < perAvailable) outcome = "late_filing";
    else outcome = "in_time";
    return {
      carrier,
      sharePct,
      damagedPerYear: carrierDamaged,
      claimsPerYear: carrierClaims,
      payableSharePct: payable * 100,
      perClaimIfPaidEur: claimValueEur(carrier, inputs, inputs.customerReportHours, 0, true),
      perClaimAvailableEur: perAvailable,
      perClaimWithGilmendEur: perWith,
      perClaimByHandEur: perHand,
      availableEur,
      withGilmendEur,
      byHandEur,
      lostByHandEur: cents(availableEur - byHandEur),
      lostWithGilmendEur: cents(availableEur - withGilmendEur),
      outcome,
      windowLabel: windowLabel(carrier),
    };
  });

  const availableEur = cents(carriers.reduce((s, c) => s + c.availableEur, 0));
  const withGilmendEur = cents(carriers.reduce((s, c) => s + c.withGilmendEur, 0));
  const byHandEur = cents(carriers.reduce((s, c) => s + c.byHandEur, 0));

  const agentSeconds = measured ? measured.meanSeconds : null;
  const gilmendMinutes = (agentSeconds ?? 0) / 60 + inputs.reviewMinutesPerCase;
  const saved = inputs.manualMinutesPerCase - gilmendMinutes;

  return {
    inputs,
    damagedPerYear,
    goodsValueEur: cents(damagedPerYear * inputs.avgOrderValueEur),
    claimsPerYear,
    carriers,
    availableEur,
    withGilmendEur,
    byHandEur,
    lostByHandEur: cents(availableEur - byHandEur),
    lostWithGilmendEur: cents(availableEur - withGilmendEur),
    gainEur: cents(withGilmendEur - byHandEur),
    time: {
      manualMinutesPerCase: inputs.manualMinutesPerCase,
      agentSecondsPerCase: agentSeconds,
      reviewMinutesPerCase: inputs.reviewMinutesPerCase,
      gilmendMinutesPerCase: gilmendMinutes,
      savedMinutesPerCase: saved,
      manualHoursPerYear: (inputs.manualMinutesPerCase * damagedPerYear) / 60,
      gilmendHoursPerYear: (gilmendMinutes * damagedPerYear) / 60,
      savedHoursPerYear: (saved * damagedPerYear) / 60,
    },
  };
}

/**
 * The binding closing time of a carrier, in hours after delivery, from the rules: the shorter of
 * the claim deadline (when counted from delivery) and a binding reserve window. null for a
 * carrier whose only deadline is counted from the order and whose reserve window only warns.
 */
export function bindingWindowHours(carrier: CarrierId): number | null {
  const rules = getCarrierRulesDetailed(carrier);
  const candidates: number[] = [];
  if (rules.claimDeadlineFrom === "delivery") candidates.push(rules.claimDeadlineDays * 24);
  if (rules.reserveDeadlineBinding) candidates.push(rules.reserveDeadlineHours);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}
