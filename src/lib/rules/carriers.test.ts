import { describe, expect, it } from "vitest";
import {
  computeClaim,
  figuresNeedingCheck,
  getCarrierRules,
  getCarrierRulesDetailed,
  isWorthFiling,
  MIN_WORTHWHILE_CLAIM_EUR,
  rulesLastReviewed,
} from "./carriers";
import type { CarrierId, DamageAssessment, Order } from "../types";

// All dates are UTC. The parcel is delivered on Tuesday 2026-10-20 at 10:00.
const DELIVERED = "2026-10-20T10:00:00.000Z";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string) => new Date(iso);
const afterDelivery = (ms: number) => new Date(Date.parse(DELIVERED) + ms);
const reportAfter = (ms: number) => new Date(Date.parse(DELIVERED) + ms).toISOString();

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "#1042",
    name: "Test Customer",
    email: "customer@example.com",
    createdAt: "2026-10-15T08:00:00.000Z",
    deliveredAt: DELIVERED,
    carrier: "colissimo",
    service: "Colissimo Domicile sans signature",
    trackingNumber: "TEST0000001",
    weightKg: 1.2,
    currency: "EUR",
    lineItems: [{ sku: "VASE-1", title: "Ceramic Vase", quantity: 1, unitPrice: 45 }],
    total: 45,
    shippingAddress: { city: "Lyon", country: "FR" },
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<DamageAssessment> = {}): DamageAssessment {
  return {
    item: "ceramic vase",
    damageType: "broken_product",
    severity: "major",
    carrierLikelyAtFault: true,
    packagingAdequate: true,
    evidenceNotes: [],
    photoQuality: "ok",
    ...overrides,
  };
}

const joined = (reasons: string[]) => reasons.join("\n");

describe("carrier rules file", () => {
  it.each<CarrierId>(["colissimo", "mondial_relay", "chronopost"])(
    "%s has dated sources and a status on every figure",
    (carrier) => {
      const rules = getCarrierRulesDetailed(carrier);
      expect(rules.carrier).toBe(carrier);
      expect(rules.sources.length).toBeGreaterThan(0);
      for (const s of rules.sources) {
        expect(s.url).toMatch(/^https:\/\//);
        expect(s.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      expect(rules.figures.length).toBeGreaterThan(0);
      for (const f of rules.figures) {
        expect(["verified", "dated_source", "unverified"]).toContain(f.status);
        expect(f.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    },
  );

  it("holds the figures the spec asks for", () => {
    expect(getCarrierRules("colissimo")).toMatchObject({
      reserveDeadlineHours: 72,
      compensation: { perKgEur: 23, capEur: 690 },
    });
    expect(getCarrierRules("mondial_relay")).toMatchObject({
      reserveDeadlineHours: 72,
      requiresRefusal: true,
      compensation: { flatEur: 25, capEur: 25 },
    });
    expect(getCarrierRules("chronopost")).toMatchObject({
      reserveDeadlineHours: 72,
      claimDeadlineDays: 3,
      compensation: { flatEur: 250, capEur: 250 },
    });
    const chrono = getCarrierRulesDetailed("chronopost");
    expect(chrono.compensationVariants[0].compensation).toEqual({ perKgEur: 23, capEur: 690 });
  });

  it("marks what could not be confirmed instead of hiding it", () => {
    expect(figuresNeedingCheck("colissimo").map((f) => f.status).sort()).toContain("unverified");
    expect(joined(getCarrierRules("colissimo").notes)).toMatch(/UNVERIFIED/);
    expect(joined(getCarrierRules("colissimo").notes)).toMatch(/DATED SOURCE/);
    expect(figuresNeedingCheck("mondial_relay")).toEqual([]);
    expect(figuresNeedingCheck("chronopost")).toEqual([]);
  });

  it("returns a copy so a caller cannot change the rules for everybody", () => {
    const first = getCarrierRules("mondial_relay");
    first.compensation.capEur = 9999;
    expect(getCarrierRules("mondial_relay").compensation.capEur).toBe(25);
  });

  it("rejects an unknown carrier and exposes the review date", () => {
    expect(() => getCarrierRules("ups" as CarrierId)).toThrow(/Unknown carrier/);
    expect(rulesLastReviewed()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("computeClaim: Colissimo", () => {
  const order = makeOrder();

  it("pays the lower of item value and 23 EUR/kg", () => {
    const c = computeClaim(order, makeAssessment(), reportAfter(2 * HOUR), afterDelivery(3 * HOUR));
    expect(c.eligible).toBe(true);
    expect(c.maxCompensationEur).toBe(27.6); // 23 x 1.2, below the 45 EUR value
    expect(joined(c.reasons)).toMatch(/Maximum compensation: min\(item value 45\.00 EUR, 23 EUR\/kg x 1\.2 kg = 27\.60 EUR, cap 690\.00 EUR\) = 27\.60 EUR/);
  });

  it("pays the item value when it is below the weight formula", () => {
    const o = makeOrder({ weightKg: 5, lineItems: [{ sku: "A", title: "Ceramic Vase", quantity: 1, unitPrice: 10 }] });
    const c = computeClaim(o, makeAssessment(), reportAfter(HOUR), afterDelivery(2 * HOUR));
    expect(c.maxCompensationEur).toBe(10);
  });

  it("gives 9.20 EUR for a 0.4 kg parcel and says it is not worth filing", () => {
    const o = makeOrder({ weightKg: 0.4, lineItems: [{ sku: "A", title: "Ceramic Vase", quantity: 1, unitPrice: 60 }] });
    const c = computeClaim(o, makeAssessment(), reportAfter(HOUR), afterDelivery(2 * HOUR));
    expect(c.eligible).toBe(true);
    expect(c.maxCompensationEur).toBe(9.2);
    expect(isWorthFiling(c)).toBe(false);
    expect(joined(c.reasons)).toMatch(/below 15\.00 EUR/);
    expect(MIN_WORTHWHILE_CLAIM_EUR).toBe(15);
  });

  it("caps an expensive heavy parcel at 690 EUR", () => {
    const o = makeOrder({ weightKg: 40, lineItems: [{ sku: "A", title: "Ceramic Vase", quantity: 1, unitPrice: 2000 }] });
    const c = computeClaim(o, makeAssessment(), reportAfter(HOUR), afterDelivery(2 * HOUR));
    expect(c.maxCompensationEur).toBe(690); // 2000 value, 920 by weight, 690 cap
    expect(isWorthFiling(c)).toBe(true);
  });

  it("uses 33 EUR/kg and 990 EUR with signature, but not for 'sans signature'", () => {
    const withSig = makeOrder({
      service: "Colissimo Domicile avec signature",
      weightKg: 40,
      lineItems: [{ sku: "A", title: "Ceramic Vase", quantity: 1, unitPrice: 3000 }],
    });
    expect(computeClaim(withSig, makeAssessment(), reportAfter(HOUR), afterDelivery(2 * HOUR)).maxCompensationEur).toBe(990);
    const light = { ...withSig, weightKg: 1.2, lineItems: [{ sku: "A", title: "Ceramic Vase", quantity: 1, unitPrice: 100 }] };
    expect(computeClaim(light, makeAssessment(), reportAfter(HOUR), afterDelivery(2 * HOUR)).maxCompensationEur).toBe(39.6);
    const without = { ...light, service: "Colissimo Domicile sans signature" };
    expect(computeClaim(without, makeAssessment(), reportAfter(HOUR), afterDelivery(2 * HOUR)).maxCompensationEur).toBe(27.6);
  });

  it("counts the 12 months from the order date, as a safe proxy for the pick-up", () => {
    const c = computeClaim(order, makeAssessment(), reportAfter(HOUR), afterDelivery(2 * HOUR));
    // Order created 2026-10-15T08:00Z, +365 days.
    expect(c.claimDeadline).toBe("2027-10-15T08:00:00.000Z");
    expect(c.daysLeft).toBe(359);
    expect(c.reserveDeadline).toBe("2026-10-23T10:00:00.000Z");
  });

  it("only warns about a late report, because the 72 h window is not confirmed for Colissimo", () => {
    const c = computeClaim(order, makeAssessment(), reportAfter(10 * DAY), afterDelivery(10 * DAY));
    expect(c.eligible).toBe(true);
    expect(joined(c.reasons)).toMatch(/Warning: .*240 h after delivery.*prudential/);
  });

  it("refuses a claim after the 12 months", () => {
    const c = computeClaim(order, makeAssessment(), reportAfter(HOUR), at("2027-10-15T08:00:00.001Z"));
    expect(c.eligible).toBe(false);
    expect(c.claimDeadline).toBeNull();
    expect(c.daysLeft).toBeNull();
    expect(joined(c.reasons)).toMatch(/deadline of Colissimo.*passed/);
  });

  it("cannot compute a per-kg indemnity for a 0 kg parcel, and keeps the clock", () => {
    const c = computeClaim(makeOrder({ weightKg: 0 }), makeAssessment(), reportAfter(HOUR), afterDelivery(2 * HOUR));
    expect(c.eligible).toBe(false);
    expect(c.maxCompensationEur).toBe(0);
    expect(joined(c.reasons)).toMatch(/weight is 0 kg/);
    expect(c.claimDeadline).not.toBeNull();
    expect(c.daysLeft).not.toBeNull();
  });

  it("treats a missing weight (NaN) like zero", () => {
    const c = computeClaim(makeOrder({ weightKg: Number.NaN }), makeAssessment(), reportAfter(HOUR), afterDelivery(2 * HOUR));
    expect(c.eligible).toBe(false);
    expect(joined(c.reasons)).toMatch(/weight is missing/);
  });

  it("adds the purchase-value caveat to an eligible claim", () => {
    const c = computeClaim(order, makeAssessment(), reportAfter(HOUR), afterDelivery(2 * HOUR));
    expect(joined(c.reasons)).toMatch(/Note: Colissimo pays the purchase value/);
  });
});

describe("computeClaim: Mondial Relay", () => {
  const order = makeOrder({
    carrier: "mondial_relay",
    service: "Mondial Relay Point Relais",
    weightKg: 1.5,
    lineItems: [{ sku: "L1", title: "Table Lamp", quantity: 1, unitPrice: 80 }],
  });
  const assessment = makeAssessment({ item: "table lamp" });

  it("pays 25 EUR per parcel at most", () => {
    const c = computeClaim(order, assessment, reportAfter(10 * HOUR), afterDelivery(11 * HOUR), { parcelRefusedAtDelivery: true });
    expect(c.eligible).toBe(true);
    expect(c.maxCompensationEur).toBe(25);
    expect(joined(c.reasons)).toMatch(/refused the parcel at delivery/);
  });

  it("pays the item value when it is below 25 EUR", () => {
    const cheap = makeOrder({ ...order, lineItems: [{ sku: "L1", title: "Table Lamp", quantity: 1, unitPrice: 12 }] });
    const c = computeClaim(cheap, assessment, reportAfter(HOUR), afterDelivery(2 * HOUR), { parcelRefusedAtDelivery: true });
    expect(c.maxCompensationEur).toBe(12);
  });

  it("is still in time exactly 72 h after delivery, with under 24 h warning", () => {
    const c = computeClaim(order, assessment, reportAfter(72 * HOUR), afterDelivery(72 * HOUR), { parcelRefusedAtDelivery: true });
    expect(c.eligible).toBe(true);
    expect(c.claimDeadline).toBe("2026-10-23T10:00:00.000Z");
    expect(c.reserveDeadline).toBe("2026-10-23T10:00:00.000Z");
    expect(c.daysLeft).toBe(0);
    expect(joined(c.reasons)).toMatch(/Warning: less than 24 h left/);
  });

  it("is too late one millisecond after the 72 h", () => {
    const c = computeClaim(order, assessment, reportAfter(HOUR), afterDelivery(72 * HOUR + 1), { parcelRefusedAtDelivery: true });
    expect(c.eligible).toBe(false);
    expect(c.maxCompensationEur).toBe(0);
    expect(c.claimDeadline).toBeNull();
    expect(c.daysLeft).toBeNull();
    // The reserve date stays visible: it tells the merchant when the window closed.
    expect(c.reserveDeadline).toBe("2026-10-23T10:00:00.000Z");
    expect(joined(c.reasons)).toMatch(/passed on 2026-10-23T10:00Z/);
  });

  it("blocks a report made after the 72 h reserve window", () => {
    const c = computeClaim(order, assessment, reportAfter(73 * HOUR), afterDelivery(73 * HOUR + HOUR / 2), { parcelRefusedAtDelivery: true });
    expect(c.eligible).toBe(false);
    expect(joined(c.reasons)).toMatch(/73 h after delivery, after the 72 h reserve window/);
  });

  it("needs the parcel to have been refused: yes passes, no blocks, unknown warns", () => {
    const base = [order, assessment, reportAfter(HOUR), afterDelivery(2 * HOUR)] as const;
    expect(computeClaim(...base, { parcelRefusedAtDelivery: false })).toMatchObject({ eligible: false, maxCompensationEur: 0, claimDeadline: null });
    expect(joined(computeClaim(...base, { parcelRefusedAtDelivery: false }).reasons)).toMatch(/accepted, so the claim would be rejected/);
    const unknown = computeClaim(...base);
    expect(unknown.eligible).toBe(true);
    expect(joined(unknown.reasons)).toMatch(/Warning: Mondial Relay \(Offre Start\) only accepts claims when the recipient refused/);
    expect(computeClaim(...base, { parcelRefusedAtDelivery: null }).eligible).toBe(true);
  });

  it("handles a missing item (opened parcel) inside 72 h", () => {
    const c = computeClaim(
      order,
      makeAssessment({ item: "table lamp", damageType: "missing_item", severity: "total" }),
      reportAfter(20 * HOUR),
      afterDelivery(21 * HOUR),
      { parcelRefusedAtDelivery: true },
    );
    expect(c.eligible).toBe(true);
    expect(c.daysLeft).toBe(2);
    expect(joined(c.reasons)).toMatch(/missing item/);
  });
});

describe("computeClaim: Chronopost", () => {
  const base = makeOrder({
    carrier: "chronopost",
    service: "Chrono 13",
    weightKg: 2,
    lineItems: [{ sku: "E1", title: "Wooden Frame", quantity: 1, unitPrice: 400 }],
  });
  const assessment = makeAssessment({ item: "wooden frame" });

  it("pays at most 250 EUR per parcel by default", () => {
    const c = computeClaim(base, assessment, reportAfter(HOUR), afterDelivery(2 * HOUR));
    expect(c.eligible).toBe(true);
    expect(c.maxCompensationEur).toBe(250);
  });

  it("pays the item value when below 250 EUR", () => {
    const o = makeOrder({ ...base, lineItems: [{ sku: "E1", title: "Wooden Frame", quantity: 1, unitPrice: 100 }] });
    expect(computeClaim(o, assessment, reportAfter(HOUR), afterDelivery(2 * HOUR)).maxCompensationEur).toBe(100);
  });

  it.each(["Chrono 18", "Chrono Classic", "Chrono Relais Europe"])(
    "switches to 23 EUR/kg for %s",
    (service) => {
      const c = computeClaim({ ...base, service }, assessment, reportAfter(HOUR), afterDelivery(2 * HOUR));
      expect(c.maxCompensationEur).toBe(46); // 23 x 2 kg
    },
  );

  it("caps the per-kg formula at 690 EUR", () => {
    const o = makeOrder({ ...base, service: "Chrono 18", weightKg: 50, lineItems: [{ sku: "E1", title: "Wooden Frame", quantity: 1, unitPrice: 5000 }] });
    expect(computeClaim(o, assessment, reportAfter(HOUR), afterDelivery(2 * HOUR)).maxCompensationEur).toBe(690);
  });

  it("switches to 23 EUR/kg for a parcel with a mobile phone item", () => {
    const o = makeOrder({ ...base, lineItems: [{ sku: "P1", title: "Phone Case", quantity: 1, unitPrice: 30 }] });
    const c = computeClaim(o, makeAssessment({ item: "phone case" }), reportAfter(HOUR), afterDelivery(2 * HOUR));
    expect(c.maxCompensationEur).toBe(30); // min(30, 46, 690)
    expect(joined(c.reasons)).toMatch(/Chrono 18, Chrono Classic, Chrono Relais Europe, or a parcel with mobile phone items/);
  });

  it("does not mistake headphones for a phone", () => {
    const o = makeOrder({ ...base, lineItems: [{ sku: "H1", title: "Wireless Headphones", quantity: 1, unitPrice: 300 }] });
    const c = computeClaim(o, makeAssessment({ item: "headphones" }), reportAfter(HOUR), afterDelivery(2 * HOUR));
    expect(c.maxCompensationEur).toBe(250);
  });

  it("is in time exactly 3 days after delivery and late a millisecond later", () => {
    const onTime = computeClaim(base, assessment, reportAfter(3 * DAY), afterDelivery(3 * DAY));
    expect(onTime.eligible).toBe(true);
    expect(onTime.daysLeft).toBe(0);
    const late = computeClaim(base, assessment, reportAfter(HOUR), afterDelivery(3 * DAY + 1));
    expect(late.eligible).toBe(false);
    expect(late.claimDeadline).toBeNull();
  });

  it("counts whole days left, rounding down", () => {
    const c = computeClaim(base, assessment, reportAfter(HOUR), afterDelivery(5 * HOUR));
    // Deadline is 3 days after 10:00; 67 h remain, which is 2 whole days.
    expect(c.daysLeft).toBe(2);
    expect(c.claimDeadline).toBe("2026-10-23T10:00:00.000Z");
  });
});

describe("computeClaim: cases with nothing to claim", () => {
  const order = makeOrder();
  const run = (a: Partial<DamageAssessment>, o: Order = order) =>
    computeClaim(o, makeAssessment(a), reportAfter(HOUR), afterDelivery(2 * HOUR));

  it("crushed packaging with an intact product is not a claim", () => {
    const c = run({ damageType: "crushed_packaging", severity: "none", item: "ceramic vase" });
    expect(c.eligible).toBe(false);
    expect(c.maxCompensationEur).toBe(0);
    expect(c.claimDeadline).toBeNull();
    expect(c.reserveDeadline).toBeNull();
    expect(c.daysLeft).toBeNull();
    expect(joined(c.reasons)).toMatch(/outer packaging is crushed and the product itself is intact/);
  });

  it("crushed packaging with a damaged product is a claim", () => {
    const c = run({ damageType: "crushed_packaging", severity: "major" });
    expect(c.eligible).toBe(true);
  });

  it("no damage at all is not a claim", () => {
    const c = run({ damageType: "unclear", severity: "none" });
    expect(c.eligible).toBe(false);
    expect(joined(c.reasons)).toMatch(/no damage to the goods/);
  });

  it("a damage the carrier did not cause is not a claim", () => {
    const c = run({ carrierLikelyAtFault: false });
    expect(c.eligible).toBe(false);
    expect(c.claimDeadline).toBeNull();
    expect(joined(c.reasons)).toMatch(/does not look caused by the carrier/);
  });

  it("a reading of inadequate packaging keeps the claim and warns the merchant (27 Oct 2026)", () => {
    // Muse said "inadequate" on two of four runs of the same broken-vase photos; the claim must
    // not vanish on that reading. It stays eligible, with the full amount and its deadlines.
    const adequate = run({ packagingAdequate: true });
    const c = run({ packagingAdequate: false });
    expect(c.eligible).toBe(true);
    expect(c.maxCompensationEur).toBe(adequate.maxCompensationEur);
    expect(c.maxCompensationEur).toBeGreaterThan(0);
    expect(c.claimDeadline).toBe(adequate.claimDeadline);
    expect(c.basis).toEqual(adequate.basis);
    expect(joined(c.reasons)).toMatch(
      /Warning: the photos suggest the packaging may be judged inadequate; the carrier may refuse compensation on that ground\./,
    );
    expect(joined(c.reasons)).toMatch(/Check the packing before filing\./);
  });

  it("states a packaging exclusion only for carriers whose recorded terms have one", () => {
    // Colissimo and Chronopost notes record the clause; Mondial Relay's do not, and we do not
    // claim a rule we have not read.
    expect(joined(run({ packagingAdequate: false }).reasons)).toMatch(
      /terms we read exclude unsuitable packaging/,
    );
    const chronopost = computeClaim(
      makeOrder({ carrier: "chronopost", service: "Chrono 13" }),
      makeAssessment({ packagingAdequate: false }),
      reportAfter(HOUR),
      afterDelivery(2 * HOUR),
    );
    expect(joined(chronopost.reasons)).toMatch(/terms we read exclude unsuitable packaging/);
    const mondial = joined(
      computeClaim(
        makeOrder({ carrier: "mondial_relay", service: "Mondial Relay Point Relais", weightKg: 1.5 }),
        makeAssessment({ packagingAdequate: false }),
        reportAfter(HOUR),
        afterDelivery(2 * HOUR),
        { parcelRefusedAtDelivery: true },
      ).reasons,
    );
    expect(mondial).toMatch(/record no packaging exclusion, so this is a precaution/);
    expect(mondial).not.toMatch(/terms we read exclude/);
  });

  it("unknown packaging adequacy only warns", () => {
    const c = run({ packagingAdequate: null });
    expect(c.eligible).toBe(true);
    expect(joined(c.reasons)).toMatch(/Warning: the photos do not show whether the packaging was adequate/);
  });

  it("blurry photos block the claim for now but keep the clock visible", () => {
    const c = run({ photoQuality: "blurry" });
    expect(c.eligible).toBe(false);
    expect(c.maxCompensationEur).toBe(0);
    expect(joined(c.reasons)).toMatch(/photos are blurry/);
    expect(c.claimDeadline).not.toBeNull();
  });

  it("an unclear damage type asks for better photos", () => {
    const c = run({ damageType: "unclear", severity: "minor" });
    expect(c.eligible).toBe(false);
    expect(joined(c.reasons)).toMatch(/unclear from the photos/);
    expect(c.claimDeadline).not.toBeNull();
  });

  it("a parcel without delivery date has no deadline and no claim", () => {
    const c = run({}, makeOrder({ deliveredAt: null }));
    expect(c.eligible).toBe(false);
    expect(c.claimDeadline).toBeNull();
    expect(c.reserveDeadline).toBeNull();
    expect(c.daysLeft).toBeNull();
    expect(joined(c.reasons)).toMatch(/no valid delivery date/);
  });

  it("an unparseable delivery date is treated as missing", () => {
    const c = run({}, makeOrder({ deliveredAt: "last tuesday" }));
    expect(c.eligible).toBe(false);
    expect(c.claimDeadline).toBeNull();
  });

  it("an unparseable report date blocks the claim without crashing", () => {
    const c = computeClaim(order, makeAssessment(), "not a date", afterDelivery(HOUR));
    expect(c.eligible).toBe(false);
    expect(joined(c.reasons)).toMatch(/report date is invalid/);
  });

  it("an order in another currency goes to a person", () => {
    const c = run({}, makeOrder({ currency: "USD" }));
    expect(c.eligible).toBe(false);
    expect(joined(c.reasons)).toMatch(/in USD/);
  });

  it("an international parcel goes to a person", () => {
    const c = run({}, makeOrder({ shippingAddress: { city: "Madrid", country: "ES" } }));
    expect(c.eligible).toBe(false);
    expect(joined(c.reasons)).toMatch(/within France only/);
    expect(c.claimDeadline).toBeNull();
  });

  it("accepts 'France' spelled out as a domestic destination", () => {
    expect(run({}, makeOrder({ shippingAddress: { city: "Lyon", country: "France" } })).eligible).toBe(true);
  });

  it("an order without priced items has no value to claim", () => {
    const c = run({}, makeOrder({ lineItems: [] }));
    expect(c.eligible).toBe(false);
    expect(joined(c.reasons)).toMatch(/no priced item/);
  });
});

describe("computeClaim: which order line is damaged", () => {
  const multi = makeOrder({
    carrier: "chronopost",
    service: "Chrono 13",
    lineItems: [
      { sku: "V", title: "Ceramic Vase - Terracotta", quantity: 1, unitPrice: 120 },
      { sku: "L", title: "Linen Lamp Shade", quantity: 1, unitPrice: 60 },
      { sku: "C", title: "Brass Candle Holder", quantity: 1, unitPrice: 40 },
    ],
  });
  const run = (item: string, o: Order = multi) =>
    computeClaim(o, makeAssessment({ item }), reportAfter(HOUR), afterDelivery(2 * HOUR));

  it("matches the line by words, ignoring case, accents and plurals", () => {
    const c = run("terracotta vases");
    expect(c.maxCompensationEur).toBe(120);
    expect(joined(c.reasons)).not.toMatch(/Warning: "terracotta/);
  });

  it("uses the cheapest line, with a warning, when nothing matches", () => {
    const c = run("mystery object");
    expect(c.maxCompensationEur).toBe(40);
    expect(joined(c.reasons)).toMatch(/Warning: "mystery object" matches no order line/);
  });

  it("uses the cheapest of several equal matches, with a warning", () => {
    const o = makeOrder({
      ...multi,
      lineItems: [
        { sku: "V1", title: "Ceramic Vase Large", quantity: 1, unitPrice: 120 },
        { sku: "V2", title: "Ceramic Vase Small", quantity: 1, unitPrice: 50 },
      ],
    });
    const c = run("ceramic vase", o);
    expect(c.maxCompensationEur).toBe(50);
    expect(joined(c.reasons)).toMatch(/matches several order lines/);
  });

  it("counts one unit when several were ordered", () => {
    const o = makeOrder({ carrier: "chronopost", service: "Chrono 13", lineItems: [{ sku: "V", title: "Ceramic Vase", quantity: 3, unitPrice: 45 }] });
    const c = run("ceramic vase", o);
    expect(c.maxCompensationEur).toBe(45);
    expect(joined(c.reasons)).toMatch(/one unit counted, the order has 3/);
  });

  it("takes the only line whatever the model called it", () => {
    const o = makeOrder({ carrier: "chronopost", service: "Chrono 13", lineItems: [{ sku: "V", title: "Ceramic Vase", quantity: 1, unitPrice: 45 }] });
    expect(run("thing", o).maxCompensationEur).toBe(45);
  });
});

describe("computeClaim: purity", () => {
  it("gives the same answer for the same inputs and leaves the inputs alone", () => {
    const order = makeOrder();
    const assessment = makeAssessment();
    const snapshot = JSON.stringify([order, assessment]);
    const a = computeClaim(order, assessment, reportAfter(HOUR), afterDelivery(2 * HOUR));
    const b = computeClaim(order, assessment, reportAfter(HOUR), afterDelivery(2 * HOUR));
    expect(a).toEqual(b);
    expect(JSON.stringify([order, assessment])).toBe(snapshot);
  });

  it("rejects an invalid `now`", () => {
    expect(() => computeClaim(makeOrder(), makeAssessment(), reportAfter(HOUR), new Date("nope"))).toThrow(TypeError);
  });
});
