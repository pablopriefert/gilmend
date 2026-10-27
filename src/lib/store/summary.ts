import type { CaseRecord, CaseStatus } from "../types";

// Numbers of the header counter: "EUR 1,240 recoverable this month . 3 claims due this
// week". Amounts come from ClaimComputation (deterministic rules), never from the model.

/** A claim still worth chasing: awaiting the merchant's click or already approved. */
export const RECOVERABLE_STATUSES: readonly CaseStatus[] = ["approved", "needs_review"];

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
// The merchant's calendar, not the server's (Vercel runs in UTC): a case created at
// 00:30 on the 1st in Paris belongs to the new month.
const MONTH_TIMEZONE = "Europe/Paris";

function monthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MONTH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

/**
 * True when the case holds money we can still claim at `now`:
 * - status approved or needs_review;
 * - the claim computation is eligible;
 * - the agent did not decide against a carrier claim (null decision does not exclude);
 * - the claim deadline, when there is one, has not passed.
 */
export function isRecoverable(c: CaseRecord, now: Date): boolean {
  if (!RECOVERABLE_STATUSES.includes(c.status)) return false;
  if (!c.claim?.eligible) return false;
  if (c.decision?.carrierClaim === false) return false;
  if (c.claim.claimDeadline !== null && Date.parse(c.claim.claimDeadline) <= now.getTime()) {
    return false;
  }
  return true;
}

/** Sum of maxCompensationEur of recoverable cases created this (Paris) calendar month. */
export function recoverableThisMonthEur(cases: CaseRecord[], now: Date = new Date()): number {
  const thisMonth = monthKey(now);
  // Cents, to keep 23.0 + 9.2 + ... free of floating-point dust.
  const cents = cases
    .filter((c) => isRecoverable(c, now) && monthKey(new Date(c.createdAt)) === thisMonth)
    .reduce((sum, c) => sum + Math.round((c.claim?.maxCompensationEur ?? 0) * 100), 0);
  return cents / 100;
}

/**
 * Recoverable cases whose claim deadline falls within the next 7 days (a rolling week:
 * "this week" must not drop to zero on a Sunday evening), most urgent first.
 */
export function claimsDueThisWeek(cases: CaseRecord[], now: Date = new Date()): CaseRecord[] {
  const limit = now.getTime() + WEEK_MS;
  return cases
    .filter((c) => {
      if (!isRecoverable(c, now) || c.claim?.claimDeadline == null) return false;
      return Date.parse(c.claim.claimDeadline) <= limit;
    })
    .sort(
      (a, b) =>
        Date.parse(a.claim?.claimDeadline ?? "") - Date.parse(b.claim?.claimDeadline ?? ""),
    );
}

export interface CasesSummary {
  recoverableThisMonthEur: number;
  /** How many of the cases counted in recoverableThisMonthEur come from DEMO MODE (scripted decisions, not Muse). */
  demoModeCases: number;
  claimsDueThisWeek: number;
  /** Ids of the due claims, most urgent first. */
  dueCaseIds: string[];
}

export function summarizeCases(all: CaseRecord[], now: Date = new Date()): CasesSummary {
  // Recorded showcase runs are frozen snapshots of a run made on 27 Oct 2026, not money the
  // merchant can still chase today: the counter is about the live cases only.
  const cases = all.filter((c) => !c.recorded);
  const due = claimsDueThisWeek(cases, now);
  const thisMonth = monthKey(now);
  return {
    recoverableThisMonthEur: recoverableThisMonthEur(cases, now),
    demoModeCases: cases.filter(
      (c) =>
        c.engine === "demo-mock" &&
        isRecoverable(c, now) &&
        (c.claim?.maxCompensationEur ?? 0) > 0 &&
        monthKey(new Date(c.createdAt)) === thisMonth,
    ).length,
    claimsDueThisWeek: due.length,
    dueCaseIds: due.map((c) => c.id),
  };
}

export interface RecordedRunsSummary {
  /** How many recorded showcase runs are listed. */
  count: number;
  /** Sum of maxCompensationEur of the recorded runs that held money when they were run. */
  recoverableEur: number;
  /** Day of the most recent recording (YYYY-MM-DD), null when there is none. */
  asOf: string | null;
}

/**
 * The figure of the recorded showcase runs, kept apart from the live counter (final review of
 * 27 Oct 2026: on a fresh deployment the counter reads 0 because these runs are excluded, and a
 * judge saw an empty product). It is computed from the recorded cases themselves, each read as of
 * its own recording (the same frozen clock the list uses, `caseClock`), so the amount is what
 * those runs found on that day, never a number written here. A recorded run a visitor rejected
 * (the stored copy) stops counting, like a live one.
 */
export function summarizeRecordedRuns(all: CaseRecord[]): RecordedRunsSummary {
  const recorded = all.filter((c) => c.recorded);
  const cents = recorded
    .filter((c) => isRecoverable(c, new Date(c.createdAt)))
    .reduce((sum, c) => sum + Math.round((c.claim?.maxCompensationEur ?? 0) * 100), 0);
  const days = recorded.map((c) => c.recorded!.recordedOn).sort();
  return { count: recorded.length, recoverableEur: cents / 100, asOf: days.length > 0 ? days[days.length - 1] : null };
}
