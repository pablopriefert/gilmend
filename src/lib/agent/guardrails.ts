import type { ClaimComputation, DamageAssessment, Decision, Order } from "../types";
import type { RawDecision } from "./tools";

// Rules that must hold whatever the model says. The prompt asks for the same things, but
// a prompt is a request and this file is the enforcement: it can only make a decision
// stricter (raise needsHuman, drop a claim), never more permissive.

export const CONFIDENCE_THRESHOLD = 0.7;
/** Orders above this value (EUR) always go to a human. */
export const HIGH_VALUE_EUR = 300;

export interface GuardrailContext {
  order: Order | null;
  /** Order number as the customer typed it, to spot a lookup that landed elsewhere. */
  quotedOrderNumber: string;
  assessment: DamageAssessment | null;
  claim: ClaimComputation | null;
  /** Names of tools that failed with an error (critical ones force a human review). */
  toolErrors: string[];
  /** Everything the tools returned: the only place amounts and dates may come from. */
  toolOutputs: unknown[];
  /** ISO date-time the report was received (a date the reply may legitimately quote). */
  reportReceivedAt: string;
  /** The model was never shown the photos (no image input, or its server refused them). */
  photosNotRead?: boolean;
  /**
   * How many photos of the case could not be loaded and so were not shown, while others were (every
   * one missing is `photosNotRead`). The model cannot have compared the new photos with them.
   */
  photosMissing?: number;
  /** Round of the case being decided: 1 for the report, 2 and more for a follow-up (resumeAgent). */
  round?: number;
}

export interface GuardrailResult {
  decision: Decision;
  /** Human-readable list of what the guardrails changed, for the trace. */
  adjustments: string[];
}

const normaliseOrderNumber = (s: string): string => s.replace(/[#\s]/g, "").toLowerCase();

export function applyGuardrails(raw: RawDecision, ctx: GuardrailContext): GuardrailResult {
  const adjustments: string[] = [];
  const reasons = [...raw.reasons];
  let needsHuman = raw.needsHuman;
  let carrierClaim = raw.carrierClaim;
  const confidence = Math.min(1, Math.max(0, Number.isFinite(raw.confidence) ? raw.confidence : 0));

  const force = (why: string) => {
    if (!needsHuman) adjustments.push(`needsHuman forced: ${why}`);
    else adjustments.push(`needsHuman confirmed: ${why}`);
    needsHuman = true;
    reasons.push(`Guardrail: ${why}`);
  };

  // A carrier claim needs a deterministic eligibility verdict, a real order, and a
  // decision that actually involves shipping or paying (not "ask a better photo").
  if (carrierClaim) {
    const eligible = ctx.claim?.eligible === true && ctx.order !== null;
    const decisionFitsClaim = raw.decision === "reship" || raw.decision === "refund";
    if (!eligible || !decisionFitsClaim) {
      carrierClaim = false;
      adjustments.push(
        `carrierClaim dropped: ${
          !decisionFitsClaim
            ? `decision "${raw.decision}" cannot carry a claim`
            : "compute_claim did not return eligible=true for a found order"
        }`,
      );
      reasons.push("Guardrail: no carrier claim (not eligible or not computed).");
    }
  }

  // Without the photos the model's reading of the damage is a guess, and a claim is built on
  // that reading: no claim, and a human looks at the photos themselves.
  if (ctx.photosNotRead) {
    if (carrierClaim) {
      carrierClaim = false;
      adjustments.push("carrierClaim dropped: the photos were not read by the model");
      reasons.push("Guardrail: no carrier claim drafted, the model did not read the photos.");
    }
    force("the photos were not read by the model, so the damage is not assessed");
  }

  // Some of the photos could not be loaded (a file of round 1 missing from this instance, say): the
  // model judged on part of the evidence and cannot have run the check "is it the same item?" on all
  // of it. A person looks at the case.
  if (!ctx.photosNotRead && (ctx.photosMissing ?? 0) > 0) {
    force(
      `${ctx.photosMissing} photo(s) of this case could not be loaded, so the model did not see all of the evidence and could not compare the new photos with them`,
    );
  }

  // The model read the packaging as inadequate, and the claim is still on (computeClaim keeps it
  // eligible, 27 Oct 2026: a model's reading of a box must not silently cancel 52.90 EUR). A person
  // checks the packing before anything is filed. Only when the claim is really kept: a decision
  // without a carrier claim has nothing to file.
  if (carrierClaim && ctx.claim?.eligible === true && ctx.assessment?.packagingAdequate === false) {
    force(
      "the photos suggest the packaging may be judged inadequate; the carrier may refuse compensation on that ground, so check the packing before filing the claim",
    );
  }

  if (confidence < CONFIDENCE_THRESHOLD) {
    force(`confidence ${confidence.toFixed(2)} is below ${CONFIDENCE_THRESHOLD}`);
  }
  if (ctx.order === null) {
    force("the order could not be found or verified");
  } else {
    if (ctx.order.currency.toUpperCase() !== "EUR") {
      force(`order currency is ${ctx.order.currency}, the ${HIGH_VALUE_EUR} EUR threshold cannot be checked`);
    } else if (ctx.order.total > HIGH_VALUE_EUR) {
      force(`order value is above ${HIGH_VALUE_EUR} EUR`);
    }
    if (normaliseOrderNumber(ctx.order.id) !== normaliseOrderNumber(ctx.quotedOrderNumber)) {
      force(`the order found (${ctx.order.id}) differs from the one quoted (${ctx.quotedOrderNumber})`);
    }
  }
  if (raw.fraudSuspected) force("fraud or manipulation suspected");

  // The customer already answered once and the case is still not settled: asking a third time is a
  // loop, not a service. A person looks at what the customer sent (this only ever adds a human).
  if (ctx.round !== undefined && ctx.round >= 2 && raw.decision === "ask_more_photos") {
    force(
      `the customer was already asked for more in round ${ctx.round - 1} and the reply (round ${ctx.round}) still does not settle the case: a person should take over instead of asking again`,
    );
  }

  const needsAssessment = raw.decision === "reship" || raw.decision === "refund";
  if (needsAssessment && ctx.order !== null && ctx.assessment === null) {
    force("no damage assessment was recorded before a reship/refund decision");
  }
  if (
    ctx.assessment !== null &&
    ctx.assessment.photoQuality !== "ok" &&
    raw.decision !== "ask_more_photos"
  ) {
    force(`photos are ${ctx.assessment.photoQuality} but the decision is "${raw.decision}"`);
  }
  if (ctx.toolErrors.length > 0) {
    force(`tool error(s): ${[...new Set(ctx.toolErrors)].join(", ")}`);
  }

  // The model may not invent money or dates, in the reply, in the reasons, or in the free
  // text of its photo reading (assessment.item and evidenceNotes are printed in the PDF that
  // goes to the carrier: "replacement cost about 120 EUR" must not slip through there).
  //
  // The customer reply is held to a stricter rule than the rest: it may only quote the
  // maximum compensation computed for this claim and, for a refund, the amounts of the
  // order. Accepting any number a tool returned let "we will refund you 990 EUR" through,
  // because 990 is the Colissimo cap that get_carrier_rules had just returned.
  const replyAmounts: number[] = [];
  if (ctx.claim?.eligible) replyAmounts.push(ctx.claim.maxCompensationEur);
  if (raw.decision === "refund" && ctx.order) {
    replyAmounts.push(ctx.order.total);
    for (const line of ctx.order.lineItems) replyAmounts.push(line.unitPrice, line.unitPrice * line.quantity);
  }
  const ungroundedReply = findUngroundedFigures(
    [raw.customerReply],
    ctx.toolOutputs,
    ctx.reportReceivedAt,
    replyAmounts,
  );
  if (ungroundedReply.length > 0) {
    force(`the customer reply states figures this case does not allow: ${ungroundedReply.join(", ")}`);
  }
  const ungrounded = findUngroundedFigures(
    [...raw.reasons, ...(ctx.assessment ? [ctx.assessment.item, ...ctx.assessment.evidenceNotes] : [])],
    ctx.toolOutputs,
    ctx.reportReceivedAt,
  );
  if (ungrounded.length > 0) {
    force(`text states figures no tool returned: ${ungrounded.join(", ")}`);
  }

  return {
    decision: {
      decision: raw.decision,
      carrierClaim,
      confidence,
      reasons,
      needsHuman,
      customerReply: raw.customerReply,
    },
    adjustments,
  };
}

// ---------------------------------------------------------------------------------
// Money and dates the model wrote but no tool returned.
// Heuristic by design: it looks for amounts with a currency marker and for calendar
// dates, which are the two things a customer could act on. Relative wording ("within
// 3 days") is not checked.

const NUMBER = "\\d{1,3}(?:[\\s\\u00a0,.]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
const AMOUNT_RE = new RegExp(
  `(?:[€$£]\\s?(${NUMBER}))|(?:(${NUMBER})\\s?(?:€|\\$|£|eur\\b|euros?\\b|usd\\b|dollars?\\b))`,
  "gi",
);

export function parseAmount(raw: string): number {
  let s = raw.replace(/[\s ]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    s = s.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    // "1,240" / "1.240" (one separator followed by exactly 3 digits) reads as thousands.
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      s = parts.join("");
    } else {
      s = s.replace(sep, ".");
    }
  }
  return Number.parseFloat(s);
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, janvier: 1,
  february: 2, feb: 2, fevrier: 2, février: 2,
  march: 3, mar: 3, mars: 3,
  april: 4, apr: 4, avril: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, juin: 6,
  july: 7, jul: 7, juillet: 7,
  august: 8, aug: 8, aout: 8, août: 8,
  september: 9, sep: 9, sept: 9, septembre: 9,
  october: 10, oct: 10, octobre: 10,
  november: 11, nov: 11, novembre: 11,
  december: 12, dec: 12, decembre: 12, décembre: 12,
};
const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

interface FoundDate {
  text: string;
  year: number | null;
  month: number;
  day: number;
}

function validMd(m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

export function extractDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validMd(mo, d)) out.push({ text: m[0], year: y, month: mo, day: d });
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validMd(mo, d)) out.push({ text: m[0], year: y, month: mo, day: d });
  }
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th|er)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b(?:,?\\s+(\\d{4}))?`,
    "gi",
  );
  for (const m of text.matchAll(dayFirst)) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo && validMd(mo, d)) out.push({ text: m[0], year: m[3] ? Number(m[3]) : null, month: mo, day: d });
  }
  const monthFirst = new RegExp(
    `\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`,
    "gi",
  );
  for (const m of text.matchAll(monthFirst)) {
    const d = Number(m[2]);
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo && validMd(mo, d)) out.push({ text: m[0], year: m[3] ? Number(m[3]) : null, month: mo, day: d });
  }
  return out;
}

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (typeof value === "number") into.push(String(value));
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, into));
  else if (typeof value === "object" && value !== null) {
    Object.values(value).forEach((v) => collectStrings(v, into));
  }
}

/**
 * Amounts and dates in `texts` that appear in none of the tool outputs.
 * With `allowedAmounts`, amounts are checked against that list ONLY (the tool outputs then
 * only ground the dates): used for the customer reply, which may not quote a cap or a price
 * that merely appears somewhere in a tool result.
 */
export function findUngroundedFigures(
  texts: string[],
  toolOutputs: unknown[],
  reportReceivedAt: string,
  allowedAmounts?: readonly number[],
): string[] {
  const pool: string[] = [reportReceivedAt];
  collectStrings(toolOutputs, pool);

  const allowedNumbers = new Set<number>();
  const allowedDates: FoundDate[] = [];
  for (const s of pool) {
    // Dates are not amounts: strip them first so "2026-10-27" does not allow "EUR 10".
    const withoutDates = s.replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g, " ");
    for (const n of withoutDates.matchAll(/\d+(?:[.,]\d+)?/g)) {
      const v = parseAmount(n[0]);
      if (Number.isFinite(v)) allowedNumbers.add(Math.round(v * 100) / 100);
    }
    allowedDates.push(...extractDates(s));
  }

  const amountPool = allowedAmounts
    ? new Set(allowedAmounts.map((n) => Math.round(n * 100) / 100))
    : allowedNumbers;

  const bad: string[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(AMOUNT_RE)) {
      const v = parseAmount(m[1] ?? m[2]);
      if (Number.isFinite(v) && !amountPool.has(Math.round(v * 100) / 100)) bad.push(m[0].trim());
    }
    for (const d of extractDates(text)) {
      const known = allowedDates.some(
        (a) => a.month === d.month && a.day === d.day && (d.year === null || a.year === null || a.year === d.year),
      );
      if (!known) bad.push(d.text);
    }
  }
  return [...new Set(bad)];
}

/**
 * Free text of the model with every amount and calendar date removed. The claim PDF and
 * e-mail take their money and dates from computeClaim only, so a figure the model wrote in
 * its photo reading must not be printed there, whatever the guardrail decided.
 */
export function stripFigures(text: string): string {
  let out = text.replace(AMOUNT_RE, " ");
  for (const d of extractDates(text)) out = out.split(d.text).join(" ");
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}
