import type { CarrierId, CarrierRules } from "../types";

// Why a richer type than CarrierRules: the shared contract only has one compensation
// formula per carrier, but real terms depend on the service (Colissimo with signature,
// Chrono 18...) and every figure needs a status the UI can show. The extra fields live
// here so the shared types.ts stays untouched; a CarrierRulesDetailed is still a valid
// CarrierRules wherever the contract asks for one.

/**
 * - verified: the figure was read in an official, current-looking source on `checkedOn`;
 * - dated_source: read in an official source, but an older edition than today's contract;
 * - unverified: could not be confirmed (derived, inferred or not published).
 */
export type FigureStatus = "verified" | "dated_source" | "unverified";

export interface RuleFigure {
  /** Dotted path of the figure in the rules, or "variant.<id>". */
  key: string;
  label: string;
  value: string;
  status: FigureStatus;
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD). */
  checkedOn: string;
  note: string;
}

export interface Compensation {
  perKgEur?: number;
  flatEur?: number;
  capEur: number;
}

export interface CompensationVariant {
  id: string;
  label: string;
  /**
   * The variant applies when the service name matches `serviceIncludes` (and none of
   * `serviceExcludes`), OR when `itemPattern` matches the title of any line item.
   * Service names are compared case-insensitively.
   */
  when: {
    serviceIncludes?: string[];
    serviceExcludes?: string[];
    /** RegExp source, compared case-insensitively against each line item title. */
    itemPattern?: string;
  };
  compensation: Compensation;
}

export interface CarrierRulesDetailed extends CarrierRules {
  /** Which date `claimDeadlineDays` counts from. "shipment" is proxied by the order date. */
  claimDeadlineFrom: "delivery" | "shipment";
  /**
   * true: a customer report after the reserve window blocks the claim (written in the
   * carrier's terms); false: the window is only prudential and yields a warning.
   */
  reserveDeadlineBinding: boolean;
  compensationVariants: CompensationVariant[];
  figures: RuleFigure[];
  /** Advisory sentence added to an eligible claim's reasons (what the ceiling does not cover). */
  compensationCaveat?: string;
}

export interface CarrierRulesFile {
  schemaVersion: number;
  /** ISO date (YYYY-MM-DD) of the last human review of the whole file. */
  lastReviewed: string;
  disclaimer: string;
  carriers: Record<CarrierId, CarrierRulesDetailed>;
}

export const CARRIER_IDS: readonly CarrierId[] = ["colissimo", "mondial_relay", "chronopost"];

const FIGURE_STATUSES: readonly FigureStatus[] = ["verified", "dated_source", "unverified"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function fail(path: string, problem: string): never {
  throw new Error(`carriers.json invalid at ${path}: ${problem}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkNumber(v: unknown, path: string, opts: { min: number }): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < opts.min) {
    fail(path, `expected a finite number >= ${opts.min}, got ${JSON.stringify(v)}`);
  }
  return v;
}

function checkString(v: unknown, path: string): string {
  if (typeof v !== "string" || v.trim() === "") fail(path, "expected a non-empty string");
  return v;
}

function checkCompensation(v: unknown, path: string): void {
  if (!isRecord(v)) return fail(path, "expected an object");
  checkNumber(v.capEur, `${path}.capEur`, { min: 0 });
  if (v.perKgEur === undefined && v.flatEur === undefined) {
    fail(path, "needs perKgEur or flatEur");
  }
  if (v.perKgEur !== undefined) checkNumber(v.perKgEur, `${path}.perKgEur`, { min: 0 });
  if (v.flatEur !== undefined) checkNumber(v.flatEur, `${path}.flatEur`, { min: 0 });
}

function checkStringArray(v: unknown, path: string): void {
  if (!Array.isArray(v)) return fail(path, "expected an array");
  v.forEach((s, i) => checkString(s, `${path}[${i}]`));
}

/**
 * Validates the parsed JSON at load time. A hand edit that breaks a deadline or drops a
 * source must fail loudly here (and in the tests) instead of producing a wrong claim.
 */
export function validateCarrierRulesFile(raw: unknown): CarrierRulesFile {
  if (!isRecord(raw)) return fail("$", "expected an object");
  checkNumber(raw.schemaVersion, "schemaVersion", { min: 1 });
  if (!ISO_DAY.test(checkString(raw.lastReviewed, "lastReviewed"))) {
    fail("lastReviewed", "expected YYYY-MM-DD");
  }
  checkString(raw.disclaimer, "disclaimer");
  if (!isRecord(raw.carriers)) return fail("carriers", "expected an object");

  for (const id of CARRIER_IDS) {
    const p = `carriers.${id}`;
    const c = raw.carriers[id];
    if (!isRecord(c)) return fail(p, "missing carrier");
    if (c.carrier !== id) fail(`${p}.carrier`, `expected "${id}"`);
    checkString(c.label, `${p}.label`);
    checkNumber(c.reserveDeadlineHours, `${p}.reserveDeadlineHours`, { min: 0 });
    checkNumber(c.claimDeadlineDays, `${p}.claimDeadlineDays`, { min: 0 });
    checkCompensation(c.compensation, `${p}.compensation`);
    if (c.claimDeadlineFrom !== "delivery" && c.claimDeadlineFrom !== "shipment") {
      fail(`${p}.claimDeadlineFrom`, 'expected "delivery" or "shipment"');
    }
    if (typeof c.reserveDeadlineBinding !== "boolean") {
      fail(`${p}.reserveDeadlineBinding`, "expected a boolean");
    }
    checkStringArray(c.notes, `${p}.notes`);
    if (c.compensationCaveat !== undefined) checkString(c.compensationCaveat, `${p}.compensationCaveat`);

    if (!Array.isArray(c.sources) || c.sources.length === 0) {
      fail(`${p}.sources`, "at least one dated source is required");
    }
    c.sources.forEach((s: unknown, i: number) => {
      const sp = `${p}.sources[${i}]`;
      if (!isRecord(s)) return fail(sp, "expected an object");
      checkString(s.title, `${sp}.title`);
      if (!checkString(s.url, `${sp}.url`).startsWith("https://")) fail(`${sp}.url`, "expected https");
      if (!ISO_DAY.test(checkString(s.checkedOn, `${sp}.checkedOn`))) fail(`${sp}.checkedOn`, "expected YYYY-MM-DD");
    });

    if (!Array.isArray(c.compensationVariants)) return fail(`${p}.compensationVariants`, "expected an array");
    c.compensationVariants.forEach((v: unknown, i: number) => {
      const vp = `${p}.compensationVariants[${i}]`;
      if (!isRecord(v)) return fail(vp, "expected an object");
      checkString(v.id, `${vp}.id`);
      checkString(v.label, `${vp}.label`);
      checkCompensation(v.compensation, `${vp}.compensation`);
      if (!isRecord(v.when)) return fail(`${vp}.when`, "expected an object");
      const w = v.when;
      if (w.serviceIncludes === undefined && w.itemPattern === undefined) {
        fail(`${vp}.when`, "needs serviceIncludes or itemPattern");
      }
      if (w.serviceIncludes !== undefined) checkStringArray(w.serviceIncludes, `${vp}.when.serviceIncludes`);
      if (w.serviceExcludes !== undefined) checkStringArray(w.serviceExcludes, `${vp}.when.serviceExcludes`);
      if (w.itemPattern !== undefined) {
        try {
          new RegExp(checkString(w.itemPattern, `${vp}.when.itemPattern`), "i");
        } catch {
          fail(`${vp}.when.itemPattern`, "not a valid regular expression");
        }
      }
    });

    if (!Array.isArray(c.figures) || c.figures.length === 0) {
      fail(`${p}.figures`, "every figure needs a status; the list cannot be empty");
    }
    c.figures.forEach((f: unknown, i: number) => {
      const fp = `${p}.figures[${i}]`;
      if (!isRecord(f)) return fail(fp, "expected an object");
      checkString(f.key, `${fp}.key`);
      checkString(f.label, `${fp}.label`);
      checkString(f.value, `${fp}.value`);
      checkString(f.note, `${fp}.note`);
      if (!FIGURE_STATUSES.includes(f.status as FigureStatus)) fail(`${fp}.status`, "unknown status");
      if (!checkString(f.sourceUrl, `${fp}.sourceUrl`).startsWith("https://")) fail(`${fp}.sourceUrl`, "expected https");
      if (!ISO_DAY.test(checkString(f.checkedOn, `${fp}.checkedOn`))) fail(`${fp}.checkedOn`, "expected YYYY-MM-DD");
    });
  }
  return raw as unknown as CarrierRulesFile;
}
