import type { CaseRecord, CaseStatus, ClaimComputation, Decision, Engine } from "../types";

// Test helper only: builds fictitious CaseRecords. Imported by tests, never by the app.

export interface FauxCaseOptions {
  id: string;
  createdAt?: string;
  status?: CaseStatus;
  /** Claim shape; null = no computation yet. */
  claim?: Partial<ClaimComputation> | null;
  carrierClaim?: boolean | null;
  /** Defaults to "demo-mock". */
  engine?: Engine;
}

export function fauxCase(o: FauxCaseOptions): CaseRecord {
  const createdAt = o.createdAt ?? "2026-10-30T10:00:00.000Z";
  const claim: ClaimComputation | null =
    o.claim === null
      ? null
      : {
          eligible: true,
          reasons: ["Within the claim window"],
          maxCompensationEur: 40,
          claimDeadline: "2026-11-02T10:00:00.000Z",
          reserveDeadline: null,
          daysLeft: 3,
          ...o.claim,
        };
  const decision: Decision | null =
    o.carrierClaim === null
      ? null
      : {
          decision: "reship",
          carrierClaim: o.carrierClaim ?? true,
          confidence: 0.9,
          reasons: ["Broken item"],
          needsHuman: false,
          customerReply: "We are sending a new one.",
        };
  return {
    id: o.id,
    report: {
      id: `report-${o.id}`,
      receivedAt: createdAt,
      customerEmail: "camille.laurent@example.com",
      orderNumber: "#1001",
      message: "My vase arrived broken",
      photos: [],
      language: "en",
    },
    order: null,
    assessment: null,
    claim,
    decision,
    evidence: [],
    document: null,
    status: o.status ?? "needs_review",
    engine: o.engine ?? "demo-mock",
    trace: [],
    createdAt,
    updatedAt: createdAt,
  };
}
