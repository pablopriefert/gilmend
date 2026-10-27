import type { CarrierId, DamageAssessment, DamageSeverity, DamageType, Engine, Order } from "../types";

// French formatting helpers for the claim PDF and e-mail. We format by hand instead of
// using Intl number formatting: fr-FR puts a narrow no-break space (U+202F) between
// thousands, and the standard PDF fonts (WinAnsi) cannot draw it.

export function formatMoney(amount: number, currency = "EUR"): string {
  const [integer, decimals] = Math.abs(amount).toFixed(2).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const symbol = currency === "EUR" ? "€" : currency;
  return `${amount < 0 ? "-" : ""}${grouped},${decimals} ${symbol}`;
}

export function formatKg(weightKg: number): string {
  return `${weightKg.toString().replace(".", ",")} kg`;
}

/** Europe/Paris, because the deadlines are French business days. */
export function formatDateFr(iso: string, withTime = false): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const text = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
  }).format(date);
  // ICU may use (narrow) no-break spaces; the PDF fonts cannot draw them.
  return text.replace(/[  ]/g, " ");
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

export const DAMAGE_TYPE_FR: Record<DamageType, string> = {
  broken_product: "produit cassé ou endommagé",
  crushed_packaging: "emballage écrasé",
  opened_parcel: "colis ouvert ou éventré",
  missing_item: "article manquant",
  unclear: "dommage à préciser",
};

export const SEVERITY_FR: Record<DamageSeverity, string> = {
  none: "aucun dommage visible sur le produit",
  minor: "dommage léger",
  major: "dommage important",
  total: "produit irrécupérable",
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
 * say "avarie constatée à la livraison" for every case: wrong when the damage was found on
 * opening a parcel that looked intact, and wrong for a parcel delivered open with an article
 * missing, which is a partial loss (spoliation) and not damage.
 */
export interface ClaimKind {
  /** E-mail subject prefix. */
  subjectPrefix: string;
  /** Short label printed under the PDF title. */
  label: string;
  /** Completes "pour vous déclarer ..." in the e-mail. */
  declaration: string;
}

export function claimKind(assessment: DamageAssessment | null): ClaimKind {
  switch (assessment?.damageType) {
    case "opened_parcel":
    case "missing_item":
      return {
        subjectPrefix: "Réclamation perte partielle (colis livré ouvert)",
        label: "Perte partielle (colis livré ouvert)",
        declaration: "un colis livré ouvert dont un article manque (perte partielle)",
      };
    case "crushed_packaging":
      return {
        subjectPrefix: "Réclamation avarie",
        label: "Avarie de colis",
        declaration: "une avarie : le colis a été livré avec un emballage endommagé",
      };
    case "broken_product":
      return {
        subjectPrefix: "Réclamation avarie",
        label: "Avarie de colis",
        declaration: "une avarie constatée à l'ouverture du colis",
      };
    default:
      return {
        subjectPrefix: "Réclamation avarie",
        label: "Avarie de colis",
        declaration: "une avarie signalée par le destinataire",
      };
  }
}
