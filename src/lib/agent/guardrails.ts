import type {
  ClaimComputation,
  DamageAssessment,
  Decision,
  IntegritySignalKind,
  Order,
  PhotoIntegrity,
} from "../types";
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
  /** Result of the photo integrity check (reused photo, capture date); null when it did not run. */
  integrity?: PhotoIntegrity | null;
  /**
   * How many photos of the case could not be loaded and so were not shown, while others were (every
   * one missing is `photosNotRead`). The model cannot have compared the new photos with them.
   */
  photosMissing?: number;
  /** Round of the case being decided: 1 for the report, 2 and more for a follow-up (resumeAgent). */
  round?: number;
}

/**
 * One thing a guardrail did, with the reason apart from the verdict (28 Oct 2026): `adjustments`
 * keeps the internal wording for the trace, and this is what the live timeline words in plain English
 * for the person who filed the report (see describeGuardrailNote).
 */
export interface GuardrailNote {
  kind: "needs_human" | "needs_human_confirmed" | "claim_dropped";
  /** The reason, already a plain sentence fragment ("confidence 0.52 is below 0.7"). */
  why: string;
}

export interface GuardrailResult {
  decision: Decision;
  /** Human-readable list of what the guardrails changed, for the trace. */
  adjustments: string[];
  /** The same changes, structured, for the live timeline. Same order as `adjustments`. */
  notes: GuardrailNote[];
}

/** The live timeline's sentence for a guardrail: plain English, no internal field names. */
export function describeGuardrailNote(note: GuardrailNote): string {
  switch (note.kind) {
    case "needs_human":
      return `Sent to a human: ${note.why}.`;
    case "needs_human_confirmed":
      return `Still needs a human: ${note.why}.`;
    case "claim_dropped":
      return `No carrier claim: ${note.why}.`;
  }
}

const INTEGRITY_KIND_WORDS: Record<IntegritySignalKind, string> = {
  reused_photo: "a photo already filed in another case",
  demo_photo_reused: "a demo photo filed for another order",
  captured_before_delivery: "a capture date before the delivery",
};

/**
 * The integrity signals as the live timeline says them: how many, and of which kind, never the
 * message of a signal (it counts other cases) and never anything about who filed them.
 */
function integrityNote(integrity: PhotoIntegrity): string {
  const n = integrity.signals.length;
  const kinds = [...new Set(integrity.signals.map((s) => INTEGRITY_KIND_WORDS[s.kind] ?? "something to look at"))];
  return `the photo check found ${n} ${n === 1 ? "thing" : "things"} to look at (${kinds.join(", ")}), a reason to look and not a verdict`;
}

const normaliseOrderNumber = (s: string): string => s.replace(/[#\s]/g, "").toLowerCase();

export function applyGuardrails(raw: RawDecision, ctx: GuardrailContext): GuardrailResult {
  const adjustments: string[] = [];
  const notes: GuardrailNote[] = [];
  const reasons = [...raw.reasons];
  let needsHuman = raw.needsHuman;
  let carrierClaim = raw.carrierClaim;
  const confidence = Math.min(1, Math.max(0, Number.isFinite(raw.confidence) ? raw.confidence : 0));

  // `plain` is the wording of the live timeline when the trace's wording would be too long or too
  // technical for it (the integrity signals, which are whole sentences for the merchant).
  const force = (why: string, plain: string = why) => {
    if (!needsHuman) adjustments.push(`needsHuman forced: ${why}`);
    else adjustments.push(`needsHuman confirmed: ${why}`);
    notes.push({ kind: needsHuman ? "needs_human_confirmed" : "needs_human", why: plain });
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
      notes.push({
        kind: "claim_dropped",
        why: !decisionFitsClaim
          ? `a “${raw.decision.replace(/_/g, " ")}” decision cannot carry a claim`
          : "the claim was not computed as eligible for a found order",
      });
      reasons.push("Guardrail: no carrier claim (not eligible or not computed).");
    }
  }

  // Without the photos the model's reading of the damage is a guess, and a claim is built on
  // that reading: no claim, and a human looks at the photos themselves.
  if (ctx.photosNotRead) {
    if (carrierClaim) {
      carrierClaim = false;
      adjustments.push("carrierClaim dropped: the photos were not read by the model");
      notes.push({ kind: "claim_dropped", why: "the model did not read the photos" });
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
  // The model's own flag (an inconsistent report, a customer message that tries to steer it). The
  // merchant reads this wording in the Why list and in the live run: it says a person must look, not
  // that the customer did something wrong (28 Oct 2026: "fraud or manipulation suspected" sat next to
  // an integrity line that says "a reason to look, not a verdict", on the same case).
  if (raw.fraudSuspected) {
    force(
      "the report needs a check (the model saw something inconsistent, or an attempt to steer it): a reason to look, not a verdict",
      "the report needs a check (something inconsistent, or an attempt to steer the agent), a reason to look and not a verdict",
    );
  }
  // Evidence integrity (src/lib/integrity): any signal sends the case to a person. It changes
  // nothing else: no claim is dropped and no decision is rejected, because a reused photo or an
  // early capture date is a reason to look, not proof (a customer can have a spare account, a
  // camera clock can be wrong). The merchant sees each signal on the case page.
  if (ctx.integrity && ctx.integrity.signals.length > 0) {
    force(
      `photo integrity: ${ctx.integrity.signals.map((s) => s.message).join(" ")} A person must check the photos before anything is filed or sent.`,
      integrityNote(ctx.integrity),
    );
  }

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
    notes,
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

// English and French, and since 28 Oct 2026 German, Spanish and Italian (the reply is written in the
// customer's language, so a date can be written in any of them: without these a German "am 5. November"
// would have gone through as a date no tool gave). A month name shared by several languages is listed once.
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, janvier: 1, januar: 1, enero: 1, gennaio: 1,
  february: 2, feb: 2, fevrier: 2, février: 2, februar: 2, febrero: 2, febbraio: 2,
  march: 3, mar: 3, mars: 3, märz: 3, maerz: 3, marzo: 3,
  april: 4, apr: 4, avril: 4, abril: 4, aprile: 4,
  may: 5, mai: 5, mayo: 5, maggio: 5,
  june: 6, jun: 6, juin: 6, juni: 6, junio: 6, giugno: 6,
  july: 7, jul: 7, juillet: 7, juli: 7, julio: 7, luglio: 7,
  august: 8, aug: 8, aout: 8, août: 8, agosto: 8,
  september: 9, sep: 9, sept: 9, septembre: 9, septiembre: 9, setiembre: 9, settembre: 9,
  october: 10, oct: 10, octobre: 10, oktober: 10, octubre: 10, ottobre: 10,
  november: 11, nov: 11, novembre: 11, noviembre: 11,
  december: 12, dec: 12, decembre: 12, décembre: 12, dezember: 12, diciembre: 12, dicembre: 12,
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
  // The numeric date without a year, the usual way to write a deadline in German, Spanish and Italian
  // ("bis zum 05.11.", "spätestens Mittwoch, 4.11.", "entro il 5/11"). It is also the shape of a decimal
  // ("1.5 L", "54.00") or a fraction, so it is guarded (28 Oct 2026):
  //  - "d.m." with a closing dot is taken as a date when no digit follows ("05.11.2026" is the full date
  //    above) and no currency sign or "EUR" comes before it;
  //  - "d.mm" or "d/m" without a closing dot only when no unit or currency follows ("1.5 L", "2.5 kg",
  //    "12.50 EUR", "10.30 Uhr" are not dates). A lone "d.m" (single-digit month, no closing dot) is too
  //    close to a decimal to be read as one, so it is left alone.
  // Day and month must be valid. A wrongly read decimal only sends a reply to a person, never lets one through.
  for (const m of text.matchAll(/(?<![\d./€$£-])(?<![€$£]\s)(?<!\b(?:eur|usd)\s)(\d{1,2})\.(\d{1,2})\.(?!\d)/gi)) {
    const [d, mo] = [Number(m[1]), Number(m[2])];
    if (validMd(mo, d)) out.push({ text: m[0], year: null, month: mo, day: d });
  }
  const UNIT_AFTER = `\\s?(?:kg|g|l|cl|ml|cm|mm|m|km|%|€|eur|euros?|usd|uhr|h|x|mal|st[uü]ck|pcs|items?|units?|lit(?:re|er)s?)\\b`;
  const yearless = new RegExp(
    `(?<![\\d./€$£-])(?<![€$£]\\s)(?<!\\b(?:eur|usd)\\s)(\\d{1,2})(?:\\.(\\d{2})|/(\\d{1,2}))(?![\\d/-])(?!\\.\\d)(?!${UNIT_AFTER})(?!\\s?[€$£])`,
    "gi",
  );
  for (const m of text.matchAll(yearless)) {
    // "4.11." is already the dotted form above; a closing dot here is just a full stop after "5/11".
    if (m[2] !== undefined && text[(m.index ?? 0) + m[0].length] === ".") continue;
    const [d, mo] = [Number(m[1]), Number(m[2] ?? m[3])];
    if (validMd(mo, d)) out.push({ text: m[0], year: null, month: mo, day: d });
  }
  // "15th November", "15 de noviembre de 2026" (Spanish), "15. November 2026" (German: a dot after the day).
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th|er)?\\.?\\s+(?:of\\s+|de\\s+|del\\s+)?(${MONTH_ALT})\\b(?:,?\\s+(?:de\\s+)?(\\d{4}))?`,
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
