import type { CarrierId, DamageAssessment, DamageSeverity, DamageType, Engine, Order } from "../types";

// Formatting helpers for the claim PDF and e-mail, in English: the product is judged in
// English (Meta hackathon, 27 Oct 2026 decision). We format by hand instead of relying on
// every Intl option: ICU may insert (narrow) no-break spaces, and the standard PDF fonts
// (WinAnsi) cannot draw U+202F.

export function formatMoney(amount: number, currency = "EUR"): string {
  const [integer, decimals] = Math.abs(amount).toFixed(2).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = amount < 0 ? "-" : "";
  return currency === "EUR" ? `${sign}€${grouped}.${decimals}` : `${sign}${currency} ${grouped}.${decimals}`;
}

export function formatKg(weightKg: number): string {
  return `${weightKg} kg`;
}

/**
 * "30 October 2026" or "30 October 2026, 23:59 (Paris time)". Europe/Paris, because the
 * carriers are French and their deadlines run on French time.
 */
export function formatDate(iso: string, withTime = false): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === type)?.value ?? "";
  const day = `${get("day")} ${get("month")} ${get("year")}`;
  return withTime ? `${day}, ${get("hour")}:${get("minute")} (Paris time)` : day;
}

/** Value of the goods in the parcel (without shipping), in the order's currency. */
export function declaredValue(order: Order): number {
  const sum = order.lineItems.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
  return Math.round(sum * 100) / 100;
}

export const CARRIER_LABELS: Record<CarrierId, string> = {
  colissimo: "Colissimo (La Poste)",
  mondial_relay: "Mondial Relay",
  chronopost: "Chronopost",
};

export const DAMAGE_TYPE_LABEL: Record<DamageType, string> = {
  broken_product: "product broken or damaged",
  crushed_packaging: "packaging crushed",
  opened_parcel: "parcel opened or torn",
  missing_item: "item missing",
  unclear: "damage to be specified",
};

export const SEVERITY_LABEL: Record<DamageSeverity, string> = {
  none: "no visible damage to the product",
  minor: "minor damage",
  major: "major damage",
  total: "product beyond repair",
};

export function engineLabel(engine: Engine): string {
  switch (engine) {
    case "muse-spark-1.3":
      return "Muse Spark 1.3 (Meta Model API)";
    case "open-weights":
      return "open-weights model";
    case "demo-mock":
      // Never let a mock run pass for a Muse run, not even in a footer.
      return "demo-mock (DEMO MODE, not Muse)";
  }
}

/**
 * What the claim is about, as the carrier's claims desk would classify it. The e-mail used to
 * say "damage found at delivery" for every case: wrong when the damage was found on opening
 * a parcel that looked intact, and wrong for a parcel delivered open with an article
 * missing, which is a partial loss (spoliation) and not damage.
 */
export interface ClaimKind {
  /** E-mail subject prefix. */
  subjectPrefix: string;
  /** Short label printed under the PDF title. */
  label: string;
  /** Completes "to report ..." in the e-mail. */
  declaration: string;
}

export function claimKind(assessment: DamageAssessment | null): ClaimKind {
  switch (assessment?.damageType) {
    case "opened_parcel":
    case "missing_item":
      return {
        subjectPrefix: "Partial loss claim (parcel delivered open)",
        label: "Partial loss (parcel delivered open)",
        declaration: "a parcel delivered open with an item missing (partial loss)",
      };
    case "crushed_packaging":
      return {
        subjectPrefix: "Damage claim",
        label: "Parcel damage",
        declaration: "damage: the parcel was delivered with damaged packaging",
      };
    case "broken_product":
      return {
        subjectPrefix: "Damage claim",
        label: "Parcel damage",
        declaration: "damage found when the parcel was opened",
      };
    default:
      return {
        subjectPrefix: "Damage claim",
        label: "Parcel damage",
        declaration: "damage reported by the recipient",
      };
  }
}
