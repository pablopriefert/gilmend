import { makeCase } from "@/components/fixtures";
import type { CarrierId, CaseRecord, ClaimComputation } from "../types";

// Test helper only: fictitious cases for the sweep tests. Imported by tests, never by the app.

/** The clock of the tests: Wed 28 Oct 2026, 10:00 UTC (11:00 in Paris). */
export const SWEEP_NOW = new Date("2026-10-28T10:00:00.000Z");

export const HOUR = 3_600_000;

/** An ISO date-time `hours` from SWEEP_NOW (negative: in the past). */
export function at(hours: number): string {
  return new Date(SWEEP_NOW.getTime() + hours * HOUR).toISOString();
}

export function claimOf(overrides: Partial<ClaimComputation> = {}): ClaimComputation {
  return {
    eligible: true,
    reasons: ["Inside the claim window."],
    maxCompensationEur: 40,
    claimDeadline: at(100),
    reserveDeadline: null,
    daysLeft: 4,
    ...overrides,
  };
}

/** A case needing a click, with an eligible claim closing `deadlineHours` from now (null: no deadline). */
export function openCase(
  id: string,
  { deadlineHours = 100, eur = 40, carrier = "colissimo" as CarrierId, ...rest }: { deadlineHours?: number | null; eur?: number; carrier?: CarrierId } & Partial<CaseRecord> = {},
): CaseRecord {
  const base = makeCase();
  return makeCase({
    id,
    report: { ...base.report, id: `rpt-${id}`, orderNumber: `#${id}` },
    order: { ...base.order!, id: `#${id}`, carrier },
    claim: claimOf({ maxCompensationEur: eur, claimDeadline: deadlineHours === null ? null : at(deadlineHours) }),
    createdAt: at(-3),
    updatedAt: at(-3),
    ...rest,
  });
}

/**
 * An approved "ask for sharper photos" case: the merchant approved the request `waitedHours` ago and
 * no reply was added. The claim is not eligible YET (blurry photos), like computeClaim writes it.
 */
export function waitingCase(
  id: string,
  waitedHours: number,
  { deadlineHours = 120, language = "en" }: { deadlineHours?: number | null; language?: string } = {},
): CaseRecord {
  const base = openCase(id, { deadlineHours });
  return {
    ...base,
    report: { ...base.report, language },
    status: "approved",
    assessment: { ...base.assessment!, photoQuality: "blurry", damageType: "unclear" },
    claim: claimOf({
      eligible: false,
      maxCompensationEur: 0,
      claimDeadline: deadlineHours === null ? null : at(deadlineHours),
      reasons: ["The photos are blurry: the damage cannot be documented for the carrier."],
    }),
    decision: { ...base.decision!, decision: "ask_more_photos", carrierClaim: false, needsHuman: false },
    trace: [...base.trace, { step: "Merchant approved the case. Ready to send; nothing was sent.", at: at(-waitedHours) }],
    updatedAt: at(-waitedHours),
  };
}
