import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_THRESHOLD,
  HIGH_VALUE_EUR,
  applyGuardrails,
  extractDates,
  findUngroundedFigures,
  parseAmount,
  stripFigures,
  type GuardrailContext,
} from "./guardrails";
import { CLAIM_OK, REPORT_AT, RULES, makeOrder } from "./test-helpers";
import type { DamageAssessment } from "../types";
import type { RawDecision } from "./tools";

const assessmentOk: DamageAssessment = {
  item: "Ceramic vase",
  damageType: "broken_product",
  severity: "major",
  carrierLikelyAtFault: true,
  packagingAdequate: true,
  evidenceNotes: [],
  photoQuality: "ok",
};

function ctx(over: Partial<GuardrailContext> = {}): GuardrailContext {
  const order = makeOrder();
  return {
    order,
    quotedOrderNumber: "#1001",
    assessment: { ...assessmentOk },
    claim: CLAIM_OK,
    toolErrors: [],
    toolOutputs: [{ found: true, order }, RULES, CLAIM_OK],
    reportReceivedAt: REPORT_AT,
    ...over,
  };
}

function raw(over: Partial<RawDecision> = {}): RawDecision {
  return {
    decision: "reship",
    carrierClaim: true,
    confidence: 0.9,
    reasons: ["Broken vase."],
    needsHuman: false,
    fraudSuspected: false,
    customerReply: "We are sending a replacement.",
    ...over,
  };
}

describe("applyGuardrails", () => {
  it("lets a clean case through untouched", () => {
    const r = applyGuardrails(raw(), ctx());
    expect(r.decision.needsHuman).toBe(false);
    expect(r.decision.carrierClaim).toBe(true);
    expect(r.adjustments).toEqual([]);
  });

  it("forces needsHuman below the confidence threshold", () => {
    const r = applyGuardrails(raw({ confidence: CONFIDENCE_THRESHOLD - 0.01 }), ctx());
    expect(r.decision.needsHuman).toBe(true);
    expect(applyGuardrails(raw({ confidence: CONFIDENCE_THRESHOLD }), ctx()).decision.needsHuman).toBe(false);
  });

  it("forces needsHuman above 300 EUR, and when the currency is not EUR", () => {
    const high = ctx({ order: makeOrder({ total: HIGH_VALUE_EUR + 0.01 }) });
    expect(applyGuardrails(raw(), high).decision.needsHuman).toBe(true);
    const exactly = ctx({ order: makeOrder({ total: HIGH_VALUE_EUR }) });
    expect(applyGuardrails(raw(), exactly).decision.needsHuman).toBe(false);
    const usd = ctx({ order: makeOrder({ currency: "USD" }) });
    expect(applyGuardrails(raw(), usd).decision.needsHuman).toBe(true);
  });

  it("forces needsHuman and drops the claim when the order is missing", () => {
    const r = applyGuardrails(raw(), ctx({ order: null, claim: null }));
    expect(r.decision.needsHuman).toBe(true);
    expect(r.decision.carrierClaim).toBe(false);
  });

  it("keeps the claim but sends it to a human when the photos suggest inadequate packaging (27 Oct 2026)", () => {
    const weak = ctx({ assessment: { ...assessmentOk, packagingAdequate: false } });
    const r = applyGuardrails(raw(), weak);
    expect(r.decision.carrierClaim).toBe(true);
    expect(r.decision.needsHuman).toBe(true);
    expect(r.decision.reasons.join(" ")).toMatch(/Guardrail: the photos suggest the packaging may be judged inadequate/);
    expect(r.decision.reasons.join(" ")).toMatch(/check the packing before filing/);
    expect(r.adjustments.join(" ")).toMatch(/needsHuman forced: the photos suggest the packaging/);
  });

  it("does not ask for a human over packaging when the packaging is fine, unknown, or no claim is kept", () => {
    for (const packagingAdequate of [true, null]) {
      const r = applyGuardrails(raw(), ctx({ assessment: { ...assessmentOk, packagingAdequate } }));
      expect(r.decision.needsHuman).toBe(false);
    }
    // No carrier claim kept (the model declined it): nothing is filed, so nothing to check.
    const noClaim = applyGuardrails(
      raw({ carrierClaim: false }),
      ctx({ assessment: { ...assessmentOk, packagingAdequate: false } }),
    );
    expect(noClaim.decision.needsHuman).toBe(false);
  });

  it("forces needsHuman on suspected fraud", () => {
    expect(applyGuardrails(raw({ fraudSuspected: true }), ctx()).decision.needsHuman).toBe(true);
  });

  it("forces needsHuman when the order found is not the one quoted", () => {
    const r = applyGuardrails(raw(), ctx({ quotedOrderNumber: "#2002" }));
    expect(r.decision.needsHuman).toBe(true);
    expect(r.decision.reasons.join(" ")).toMatch(/differs/);
  });

  it("never lets the model claim when compute_claim said not eligible or never ran", () => {
    const notEligible = { ...CLAIM_OK, eligible: false };
    expect(applyGuardrails(raw(), ctx({ claim: notEligible })).decision.carrierClaim).toBe(false);
    expect(applyGuardrails(raw(), ctx({ claim: null })).decision.carrierClaim).toBe(false);
  });

  it("does not let ask_more_photos or no_action carry a claim", () => {
    expect(applyGuardrails(raw({ decision: "ask_more_photos" }), ctx()).decision.carrierClaim).toBe(false);
    expect(applyGuardrails(raw({ decision: "no_action" }), ctx()).decision.carrierClaim).toBe(false);
  });

  it("flags a reship decision made on blurry photos, and a reship with no assessment", () => {
    const blurry = ctx({ assessment: { ...assessmentOk, photoQuality: "blurry" } });
    expect(applyGuardrails(raw(), blurry).decision.needsHuman).toBe(true);
    expect(applyGuardrails(raw({ decision: "ask_more_photos" }), blurry).decision.needsHuman).toBe(false);
    expect(applyGuardrails(raw(), ctx({ assessment: null })).decision.needsHuman).toBe(true);
  });

  it("forces needsHuman after a tool error", () => {
    expect(applyGuardrails(raw(), ctx({ toolErrors: ["compute_claim"] })).decision.needsHuman).toBe(true);
  });

  it("never lowers needsHuman and clamps a wild confidence", () => {
    const r = applyGuardrails(raw({ needsHuman: true, confidence: 7 }), ctx());
    expect(r.decision.needsHuman).toBe(true);
    expect(r.decision.confidence).toBe(1);
    expect(applyGuardrails(raw({ confidence: Number.NaN }), ctx()).decision.confidence).toBe(0);
  });

  it("blocks an invented amount in the customer reply", () => {
    const r = applyGuardrails(raw({ customerReply: "You will receive 120 EUR in compensation." }), ctx());
    expect(r.decision.needsHuman).toBe(true);
    expect(r.decision.reasons.join(" ")).toMatch(/120 EUR/);
  });

  it("accepts the maximum compensation of the claim in the customer reply", () => {
    const amount = CLAIM_OK.maxCompensationEur.toFixed(2);
    const r = applyGuardrails(raw({ customerReply: `We will claim up to €${amount} from the carrier.` }), ctx());
    expect(r.decision.needsHuman).toBe(false);
  });

  it("accepts the order total in a refund reply, but not in a reship reply", () => {
    const order = makeOrder();
    const total = order.total.toFixed(2);
    const refund = applyGuardrails(
      raw({ decision: "refund", carrierClaim: false, customerReply: `We refund your order of €${total}.` }),
      ctx(),
    );
    expect(refund.decision.needsHuman).toBe(false);
    const reship = applyGuardrails(raw({ customerReply: `We replace your €${total} order.` }), ctx());
    expect(reship.decision.needsHuman).toBe(true);
  });

  it("forces needsHuman when the reply promises a cap that only appears in the carrier rules", () => {
    // 990 is the Colissimo cap (with signature): get_carrier_rules returned it, so the old
    // check accepted it, although the computed maximum for this parcel is far lower.
    const rules = { ...RULES, compensation: { ...RULES.compensation, capEur: 990 } };
    const r = applyGuardrails(
      raw({ customerReply: "We will refund you €990 as you asked." }),
      ctx({ toolOutputs: [{ found: true, order: makeOrder() }, rules, CLAIM_OK] }),
    );
    expect(r.decision.needsHuman).toBe(true);
    expect(r.adjustments.join(" ")).toMatch(/customer reply states figures/);
    expect(r.decision.reasons.join(" ")).toMatch(/990/);
  });

  it("checks the free text of the photo reading, which is printed in the carrier PDF", () => {
    const withMoney = ctx({
      assessment: { ...assessmentOk, evidenceNotes: ["Replacement cost about €120"] },
    });
    expect(applyGuardrails(raw(), withMoney).decision.needsHuman).toBe(true);
    const inItem = ctx({ assessment: { ...assessmentOk, item: "Vase worth 200 EUR" } });
    expect(applyGuardrails(raw(), inItem).decision.needsHuman).toBe(true);
    const clean = ctx({ assessment: { ...assessmentOk, evidenceNotes: ["Vase in three pieces"] } });
    expect(applyGuardrails(raw(), clean).decision.needsHuman).toBe(false);
  });

  it("blocks an invented date in the reasons", () => {
    const r = applyGuardrails(raw({ reasons: ["Claim must be filed before 2026-12-31."] }), ctx());
    expect(r.decision.needsHuman).toBe(true);
  });
});

describe("figures grounded in tool results", () => {
  const outputs = [CLAIM_OK, { order: makeOrder() }];

  it("parses amounts the way people write them", () => {
    expect(parseAmount("1 240,50")).toBe(1240.5);
    expect(parseAmount("1,240")).toBe(1240);
    expect(parseAmount("1.240,5")).toBe(1240.5);
    expect(parseAmount("59.9")).toBe(59.9);
    expect(parseAmount("32,2")).toBe(32.2);
  });

  it("finds dates in ISO, numeric and written forms, English and French", () => {
    const found = extractDates("2026-11-15, 15/11/2026, 15 November, le 15 novembre 2026, Nov 15th");
    expect(found.map((d) => [d.month, d.day])).toEqual([
      [11, 15], [11, 15], [11, 15], [11, 15], [11, 15],
    ]);
  });

  it("accepts the tool's own deadline in any written form", () => {
    expect(findUngroundedFigures(["File before 15 November 2026."], outputs, REPORT_AT)).toEqual([]);
    expect(findUngroundedFigures(["À déposer avant le 15 novembre."], outputs, REPORT_AT)).toEqual([]);
  });

  it("rejects another day, or the same day in another year", () => {
    expect(findUngroundedFigures(["File before 16 November."], outputs, REPORT_AT)).toHaveLength(1);
    expect(findUngroundedFigures(["File before 15 November 2027."], outputs, REPORT_AT)).toHaveLength(1);
  });

  it("checks amounts with a currency marker only", () => {
    expect(findUngroundedFigures(["We checked 2 photos and 3 boxes."], outputs, REPORT_AT)).toEqual([]);
    expect(findUngroundedFigures(["You get €500."], outputs, REPORT_AT)).toEqual(["€500"]);
    expect(findUngroundedFigures(["Vous recevrez 500 euros."], outputs, REPORT_AT)).toEqual(["500 euros"]);
    expect(findUngroundedFigures(["Max is 32,20 €."], outputs, REPORT_AT)).toEqual([]);
  });

  it("does not let a date in a tool result legitimise an amount made of its digits", () => {
    // CLAIM_OK has a deadline on the 15th; "EUR 15" is not in any tool amount.
    expect(findUngroundedFigures(["You get 15 EUR."], outputs, REPORT_AT)).toEqual(["15 EUR"]);
  });
});

describe("stripFigures", () => {
  it("removes amounts and dates from free text and keeps the rest readable", () => {
    expect(stripFigures("Replacement cost about €120, delivered on 2026-10-25.")).toBe("Replacement cost about, delivered on.");
    expect(stripFigures("Vase worth 1 240,50 EUR")).toBe("Vase worth");
    expect(stripFigures("Livré le 25 octobre 2026, valeur 59 €")).toBe("Livré le, valeur");
    expect(stripFigures("Vase in three pieces")).toBe("Vase in three pieces");
  });
});

describe("applyGuardrails: some photos of the case could not be loaded", () => {
  it("forces a human and keeps the claim for the person to judge, with the count in the reason", () => {
    const r = applyGuardrails(raw(), ctx({ photosMissing: 2, round: 2 }));
    expect(r.decision.needsHuman).toBe(true);
    expect(r.decision.reasons.join(" ")).toMatch(/Guardrail: 2 photo\(s\) of this case could not be loaded, so the model did not see all of the evidence/);
    expect(r.adjustments.join(" ")).toMatch(/needsHuman forced: 2 photo\(s\)/);
  });

  it("says nothing when none is missing, and does not repeat itself when no photo was read at all", () => {
    expect(applyGuardrails(raw(), ctx({ photosMissing: 0 })).decision.needsHuman).toBe(false);
    const none = applyGuardrails(raw(), ctx({ photosNotRead: true, photosMissing: 3 }));
    expect(none.decision.reasons.join(" ")).not.toMatch(/could not be loaded/);
  });
});

describe("applyGuardrails: photos the model never saw", () => {
  it("drops an otherwise valid carrier claim and forces a human", () => {
    const r = applyGuardrails(raw(), ctx({ photosNotRead: true }));
    expect(r.decision).toMatchObject({ carrierClaim: false, needsHuman: true });
    expect(r.adjustments).toContain("carrierClaim dropped: the photos were not read by the model");
    expect(r.decision.reasons.join(" ")).toMatch(/model did not read the photos/);
  });

  it("changes nothing when the photos were read", () => {
    const r = applyGuardrails(raw(), ctx());
    expect(r.decision).toMatchObject({ carrierClaim: true, needsHuman: false });
  });
});
