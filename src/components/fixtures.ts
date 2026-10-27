// Fictitious case used by the UI and API tests. Built fresh on each call so a test can
// change it without leaking into another.
import type { CarrierRules, CaseRecord } from "@/lib/types";

export const NOW = new Date("2026-10-28T10:00:00.000Z");

export function makeCase(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: "case-1",
    report: {
      id: "rpt-1",
      receivedAt: "2026-10-28T07:00:00.000Z",
      customerEmail: "camille.laurent@example.com",
      orderNumber: "#1001",
      message: "Hi, my vase arrived broken this morning. Can you send a new one?",
      photos: ["data/runtime/uploads/rpt-1/photo-1.jpg"],
      language: "en",
    },
    order: {
      id: "#1001",
      name: "Camille Laurent",
      email: "camille.laurent@example.com",
      createdAt: "2026-10-20T09:00:00.000Z",
      deliveredAt: "2026-10-27T16:00:00.000Z",
      carrier: "colissimo",
      service: "Colissimo Domicile sans signature",
      trackingNumber: "6A99001001001",
      weightKg: 2.4,
      currency: "EUR",
      lineItems: [{ sku: "VASE-01", title: "Ceramic vase", quantity: 1, unitPrice: 58 }],
      total: 58,
      shippingAddress: { city: "Lyon", country: "FR" },
    },
    assessment: {
      item: "Ceramic vase",
      damageType: "broken_product",
      severity: "major",
      carrierLikelyAtFault: true,
      packagingAdequate: false,
      evidenceNotes: ["The vase is in several clean pieces.", "Padding looks thin for a ceramic."],
      photoQuality: "ok",
    },
    claim: {
      eligible: true,
      reasons: ["Reported within the carrier's claim window.", "Compensation is capped at the declared value."],
      maxCompensationEur: 55.2,
      claimDeadline: "2026-11-02T16:00:00.000Z",
      reserveDeadline: "2026-10-30T16:00:00.000Z",
      daysLeft: 5,
    },
    decision: {
      decision: "reship",
      carrierClaim: true,
      confidence: 0.86,
      reasons: ["Clear breakage on a 58 EUR item.", "Inside the claim window."],
      needsHuman: false,
      customerReply: "Hello Camille,\n\nI am sorry your vase arrived broken. We are sending a new one today.",
    },
    evidence: [
      {
        photo: "data/runtime/uploads/rpt-1/photo-1.jpg",
        annotatedPhoto: "data/runtime/evidence/rpt-1/photo-1-annotated.png",
        method: "sam-3.1",
        note: "Outlined the shattered base.",
      },
    ],
    document: {
      pdfPath: "data/runtime/claims/case-1.pdf",
      emailSubject: "Damage claim, tracking 6A99001001001",
      emailBody: "Dear claims department,\n\nPlease find our claim attached.",
    },
    status: "needs_review",
    engine: "muse-spark-1.3",
    trace: [
      { step: "Looked up order #1001", tool: "get_order", input: { orderNumber: "#1001" }, output: { found: true }, at: "2026-10-28T07:00:01.000Z" },
      { step: "Computed the claim", tool: "compute_claim", output: { eligible: true }, at: "2026-10-28T07:00:05.000Z" },
      { step: "Decided: reship", at: "2026-10-28T07:00:08.000Z" },
    ],
    createdAt: "2026-10-28T07:00:00.000Z",
    updatedAt: "2026-10-28T07:00:08.000Z",
    ...overrides,
  };
}

export function makeRules(overrides: Partial<CarrierRules> = {}): CarrierRules {
  return {
    carrier: "colissimo",
    label: "Colissimo",
    sources: [
      { title: "Colissimo claims conditions", url: "https://example.com/colissimo", checkedOn: "2026-10-22" },
      { title: "An old source", url: "javascript:alert(1)", checkedOn: "2026-01-02" },
    ],
    reserveDeadlineHours: 72,
    claimDeadlineDays: 5,
    compensation: { perKgEur: 23, capEur: 690 },
    notes: ["[D] The 3-day reserve rule is applied to every carrier to be safe.", "Insurance is not included."],
    ...overrides,
  };
}

/** What getCarrierRules() really returns at run time: the contract plus the status of every figure. */
export function makeRulesWithFigures() {
  return {
    ...makeRules({ notes: ["DATED SOURCE: amounts come from the 2020 edition of the terms."] }),
    figures: [
      {
        key: "compensation.perKgEur",
        label: "Indemnity per kg",
        value: "23 EUR/kg",
        status: "dated_source" as const,
        checkedOn: "2026-10-27",
        note: "Read in the 2020-12-08 edition.",
      },
      {
        key: "reserve.hours",
        label: "Reserve window",
        value: "72 h",
        status: "unverified" as const,
        checkedOn: "2026-10-27",
        note: "Applied out of prudence only.",
      },
      {
        key: "claim.days",
        label: "Claim window",
        value: "365 days",
        status: "verified" as const,
        checkedOn: "2026-10-27",
        note: "",
      },
    ],
  };
}
