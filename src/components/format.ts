import type {
  CarrierId,
  CaseRecord,
  CaseStatus,
  ClaimComputation,
  DamageSeverity,
  DamageType,
  DecisionKind,
  PhotoQuality,
} from "@/lib/types";

// Everything is formatted in an explicit time zone and locale so the server render and the
// browser render produce the same text (no hydration mismatch), whatever the machine is set to.
const TIME_ZONE = "Europe/Paris";
const DAY_MS = 86_400_000;

export function formatEur(amount: number, opts: { whole?: boolean } = {}): string {
  const whole = opts.whole ?? Number.isInteger(amount);
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}

export function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown date";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(t);
}

export function formatDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown date";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(t);
}

/** Whole days from `now` to `iso` (rounded up); negative once the date has passed. */
export function daysUntil(iso: string, now: Date): number {
  return Math.ceil((Date.parse(iso) - now.getTime()) / DAY_MS);
}

/**
 * The clock a case is read against. A recorded showcase run is a snapshot: its reasons say
 * "17.0 h after delivery" and its amounts were computed on the day of the run, so its
 * deadlines are shown as of that moment instead of turning "Overdue" a few days later.
 */
export function caseClock(c: Pick<CaseRecord, "recorded" | "createdAt">, now: Date): Date {
  return c.recorded ? new Date(c.createdAt) : now;
}

export type DeadlineTone = "none" | "ok" | "soon" | "overdue";

/**
 * Deadline text for a list row or a claim card. Computed from the stored deadline and the
 * current time (not from `claim.daysLeft`, which is frozen at the moment the claim was
 * computed and goes stale the next day).
 */
export function deadlineInfo(
  claim: Pick<ClaimComputation, "eligible" | "claimDeadline"> | null,
  now: Date,
): { text: string; tone: DeadlineTone } {
  if (!claim || !claim.eligible || !claim.claimDeadline) return { text: "No deadline", tone: "none" };
  const days = daysUntil(claim.claimDeadline, now);
  if (days < 0) return { text: "Overdue", tone: "overdue" };
  if (days === 0) return { text: "Due today", tone: "soon" };
  return { text: days === 1 ? "1 day left" : `${days} days left`, tone: days <= 3 ? "soon" : "ok" };
}

export const STATUS_LABEL: Record<CaseStatus, string> = {
  new: "New",
  needs_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
  sent_to_customer: "Sent to customer",
};

export const DECISION_LABEL: Record<DecisionKind, string> = {
  reship: "Reship",
  refund: "Refund",
  ask_more_photos: "Ask for more photos",
  no_action: "No action",
};

export const DAMAGE_TYPE_LABEL: Record<DamageType, string> = {
  broken_product: "Broken product",
  crushed_packaging: "Crushed packaging",
  opened_parcel: "Opened parcel",
  missing_item: "Missing item",
  unclear: "Unclear",
};

export const SEVERITY_LABEL: Record<DamageSeverity, string> = {
  none: "None",
  minor: "Minor",
  major: "Major",
  total: "Total loss",
};

export const PHOTO_QUALITY_LABEL: Record<PhotoQuality, string> = {
  ok: "Good",
  blurry: "Blurry",
  insufficient: "Insufficient",
};

export const CARRIER_LABEL: Record<CarrierId, string> = {
  colissimo: "Colissimo",
  mondial_relay: "Mondial Relay",
  chronopost: "Chronopost",
};

const LANGUAGE_NAMES: Record<string, string> = { en: "English", fr: "French" };

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}
