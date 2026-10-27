import { describe, expect, it } from "vitest";
import {
  bindingWindowHours,
  claimValueEur,
  computeRoi,
  DEFAULT_INPUTS,
  defaultRaw,
  FIELDS,
  fieldMeta,
  validateRoiInputs,
  type RawInputs,
  type RoiInputs,
} from "./roi";
import type { MeasuredTime } from "./measured-time";

const inputs = (over: Partial<RoiInputs> = {}): RoiInputs => ({ ...DEFAULT_INPUTS, ...over });
const raw = (over: Partial<RawInputs> = {}): RawInputs => ({ ...defaultRaw(), ...over });
const MEASURED: MeasuredTime = {
  runs: [],
  meanSeconds: 27,
  medianSeconds: 30,
  minSeconds: 15,
  maxSeconds: 35,
  recordedOn: "2026-10-27",
};

describe("ROI fields", () => {
  it("covers every input once, each labelled as the merchant's figure or an assumption, with a hint", () => {
    const keys = FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(Object.keys(DEFAULT_INPUTS).sort());
    for (const f of FIELDS) {
      expect(["yours", "assumption"]).toContain(f.kind);
      expect(f.hint.length).toBeGreaterThan(10);
      expect(f.min).toBeLessThan(f.max);
    }
  });

  it("calls the damage rate an assumption and never dresses it as a statistic", () => {
    const f = fieldMeta("damageRatePct");
    expect(f.kind).toBe("assumption");
    expect(f.hint).toMatch(/^Assumption/);
    expect(() => fieldMeta("nope" as never)).toThrow(/Unknown ROI field/);
  });

  it("keeps every default inside its own bounds", () => {
    for (const f of FIELDS) {
      expect(DEFAULT_INPUTS[f.key]).toBeGreaterThanOrEqual(f.min);
      expect(DEFAULT_INPUTS[f.key]).toBeLessThanOrEqual(f.max);
    }
  });
});

describe("validateRoiInputs", () => {
  it("accepts the defaults", () => {
    const v = validateRoiInputs(defaultRaw());
    expect(v).toEqual({ ok: true, inputs: DEFAULT_INPUTS });
  });

  it("accepts a decimal comma and surrounding spaces", () => {
    const v = validateRoiInputs(raw({ damageRatePct: " 2,5 " }));
    expect(v.ok && v.inputs.damageRatePct).toBe(2.5);
  });

  it("gives each bad field its own message", () => {
    const v = validateRoiInputs(
      raw({ ordersPerMonth: "", damageRatePct: "abc", avgOrderValueEur: "-4", avgWeightKg: "0", customerReportHours: "1e3" }),
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.ordersPerMonth).toBe("Enter a number.");
    expect(v.errors.damageRatePct).toMatch(/plain number/);
    expect(v.errors.avgOrderValueEur).toMatch(/plain number/);
    expect(v.errors.avgWeightKg).toBe("Must be at least 0.05.");
    expect(v.errors.customerReportHours).toMatch(/plain number/);
  });

  it("refuses a fraction of an order, a rate above 50% and infinity", () => {
    const v = validateRoiInputs(raw({ ordersPerMonth: "12.5", damageRatePct: "80", manualMinutesPerCase: "Infinity" }));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.ordersPerMonth).toBe("Enter a whole number.");
    expect(v.errors.damageRatePct).toBe("Must be at most 50.");
    expect(v.errors.manualMinutesPerCase).toBeDefined();
  });

  it("needs at least one carrier with a share", () => {
    const v = validateRoiInputs(raw({ shareColissimoPct: "0", shareMondialRelayPct: "0", shareChronopostPct: "0" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.shareColissimoPct).toMatch(/above 0/);
  });
});

describe("claimValueEur: the real rule code on a synthetic order", () => {
  const i = inputs();

  it("pays Mondial Relay its flat 25 EUR and Chronopost the item value up to 250 EUR", () => {
    expect(claimValueEur("mondial_relay", i, 24, 12)).toBe(25);
    expect(claimValueEur("chronopost", i, 24, 12)).toBe(60);
    expect(claimValueEur("chronopost", inputs({ avgOrderValueEur: 400 }), 24, 12)).toBe(250);
  });

  it("pays Colissimo 23 EUR/kg: a light parcel is paid less than the goods are worth, a heavy one hits the value", () => {
    expect(claimValueEur("colissimo", i, 24, 12)).toBe(34.5);
    expect(claimValueEur("colissimo", inputs({ avgWeightKg: 10, avgOrderValueEur: 500 }), 24, 12)).toBe(230);
    expect(claimValueEur("colissimo", inputs({ avgWeightKg: 10, avgOrderValueEur: 20 }), 24, 12)).toBe(20);
  });

  it("loses a Mondial Relay or Chronopost claim filed after the 72 h window, the day it closes included", () => {
    // Delivery + 24 h report + 48 h = exactly 72 h: a deadline is inclusive.
    expect(claimValueEur("mondial_relay", i, 24, 48)).toBe(25);
    expect(claimValueEur("mondial_relay", i, 24, 49)).toBe(0);
    expect(claimValueEur("chronopost", i, 24, 49)).toBe(0);
  });

  it("keeps a Colissimo claim alive for months: the short window is only a warning there", () => {
    expect(claimValueEur("colissimo", i, 24, 24 * 30)).toBe(34.5);
    expect(claimValueEur("colissimo", i, 200, 24)).toBe(34.5);
    expect(claimValueEur("colissimo", i, 24, 24 * 400)).toBe(0);
  });

  it("recovers nothing from a report made after the window, however fast the claim is filed", () => {
    expect(claimValueEur("mondial_relay", i, 100, 0)).toBe(0);
    expect(claimValueEur("chronopost", i, 100, 0)).toBe(0);
  });
});

describe("computeRoi: the money", () => {
  it("works the defaults through to the cent", () => {
    const r = computeRoi(DEFAULT_INPUTS, MEASURED);
    // 400 orders x 12 months x 2% = 96 damaged parcels; 70% qualify = 67.2 claims.
    expect(r.damagedPerYear).toBeCloseTo(96, 9);
    expect(r.claimsPerYear).toBeCloseTo(67.2, 9);
    expect(r.goodsValueEur).toBe(5760);
    const by = Object.fromEntries(r.carriers.map((c) => [c.carrier, c]));
    // Colissimo 60%: 40.32 claims x 34.50 EUR; the 72 h window is only a warning there.
    expect(by.colissimo.withGilmendEur).toBe(1391.04);
    expect(by.colissimo.byHandEur).toBe(1391.04);
    expect(by.colissimo.outcome).toBe("in_time");
    // Mondial Relay 25%: 16.8 claims x 25 EUR, lost when filed 4 days after the report.
    expect(by.mondial_relay.withGilmendEur).toBe(420);
    expect(by.mondial_relay.byHandEur).toBe(0);
    expect(by.mondial_relay.lostByHandEur).toBe(420);
    expect(by.mondial_relay.lostWithGilmendEur).toBe(0);
    expect(by.mondial_relay.outcome).toBe("late_filing");
    // Chronopost 15%: 10.08 claims x 60 EUR.
    expect(by.chronopost.withGilmendEur).toBe(604.8);
    expect(by.chronopost.lostByHandEur).toBe(604.8);
    expect(r.availableEur).toBe(2415.84);
    expect(r.withGilmendEur).toBe(2415.84);
    expect(r.byHandEur).toBe(1391.04);
    expect(r.lostByHandEur).toBe(1024.8);
    expect(r.lostWithGilmendEur).toBe(0);
    expect(r.gainEur).toBe(1024.8);
  });

  it("loses nothing when the manual process is as fast as the deadline needs", () => {
    const r = computeRoi(inputs({ manualFilingDelayDays: 0 }), MEASURED);
    expect(r.lostByHandEur).toBe(0);
    expect(r.gainEur).toBe(0);
    expect(r.byHandEur).toBe(r.withGilmendEur);
    expect(r.carriers.every((c) => c.outcome === "in_time")).toBe(true);
  });

  it("tells a late filing from a late report", () => {
    const r = computeRoi(inputs({ customerReportHours: 100 }), MEASURED);
    const by = Object.fromEntries(r.carriers.map((c) => [c.carrier, c]));
    expect(by.mondial_relay.outcome).toBe("late_report");
    expect(by.mondial_relay.withGilmendEur).toBe(0);
    expect(by.chronopost.outcome).toBe("late_report");
    expect(by.colissimo.outcome).toBe("in_time");
    // The filing delay costs nothing when nobody could have claimed anyway: the report was too late.
    expect(by.mondial_relay.availableEur).toBe(0);
    expect(by.mondial_relay.lostByHandEur).toBe(0);
  });

  it("rescales the carrier shares to 100%", () => {
    const a = computeRoi(inputs(), MEASURED);
    const b = computeRoi(inputs({ shareColissimoPct: 30, shareMondialRelayPct: 12.5, shareChronopostPct: 7.5 }), MEASURED);
    expect(b.withGilmendEur).toBe(a.withGilmendEur);
    expect(b.carriers.reduce((s, c) => s + c.sharePct, 0)).toBeCloseTo(100, 9);
    expect(b.carriers.find((c) => c.carrier === "colissimo")?.sharePct).toBeCloseTo(60, 9);
  });

  it("puts everything at zero for a shop with no damage, and says there is nothing to claim", () => {
    const r = computeRoi(inputs({ damageRatePct: 0 }), MEASURED);
    expect(r.damagedPerYear).toBe(0);
    expect(r.withGilmendEur).toBe(0);
    expect(r.time.savedHoursPerYear).toBe(0);
    expect(r.carriers.every((c) => c.outcome === "none")).toBe(true);
  });

  it("charges Gilmend too when the approval is slower than the window, instead of hiding it", () => {
    const r = computeRoi(inputs({ gilmendApprovalHours: 100, manualFilingDelayDays: 0 }), MEASURED);
    expect(r.lostWithGilmendEur).toBeGreaterThan(0);
    expect(r.gainEur).toBeLessThan(0);
    expect(r.carriers.find((c) => c.carrier === "mondial_relay")?.withGilmendEur).toBe(0);
  });

  it("never recovers more than what is available, and never reports a negative loss, whatever the delays", () => {
    for (const delayDays of [0, 0.5, 1, 2, 3, 4, 10, 60]) {
      for (const approval of [0, 6, 24, 60, 100]) {
        for (const report of [0, 12, 48, 72, 73, 200]) {
          const r = computeRoi(
            inputs({ manualFilingDelayDays: delayDays, gilmendApprovalHours: approval, customerReportHours: report }),
            MEASURED,
          );
          expect(r.lostByHandEur).toBeGreaterThanOrEqual(-0.005);
          expect(r.lostWithGilmendEur).toBeGreaterThanOrEqual(-0.005);
          expect(r.byHandEur).toBeGreaterThanOrEqual(0);
          expect(r.byHandEur).toBeLessThanOrEqual(r.availableEur + 0.005);
          expect(r.withGilmendEur).toBeLessThanOrEqual(r.availableEur + 0.005);
          for (const c of r.carriers) {
            expect(c.perClaimByHandEur).toBeLessThanOrEqual(c.perClaimAvailableEur + 1e-9);
            expect(c.perClaimWithGilmendEur).toBeLessThanOrEqual(c.perClaimAvailableEur + 1e-9);
          }
        }
      }
    }
  });

  it("scales linearly with the number of orders", () => {
    const one = computeRoi(inputs({ ordersPerMonth: 100 }), MEASURED);
    const four = computeRoi(inputs({ ordersPerMonth: 400 }), MEASURED);
    expect(four.withGilmendEur).toBeCloseTo(one.withGilmendEur * 4, 1);
  });
});

describe("computeRoi: the time", () => {
  it("adds the measured agent time to the review time, and keeps both visible", () => {
    const r = computeRoi(DEFAULT_INPUTS, MEASURED);
    expect(r.time.agentSecondsPerCase).toBe(27);
    expect(r.time.gilmendMinutesPerCase).toBeCloseTo(3.45, 9);
    expect(r.time.savedMinutesPerCase).toBeCloseTo(16.55, 9);
    // 96 cases a year.
    expect(r.time.manualHoursPerYear).toBeCloseTo(32, 9);
    expect(r.time.gilmendHoursPerYear).toBeCloseTo(5.52, 9);
    expect(r.time.savedHoursPerYear).toBeCloseTo(26.48, 9);
  });

  it("does not invent an agent time when none was measured", () => {
    const r = computeRoi(DEFAULT_INPUTS, null);
    expect(r.time.agentSecondsPerCase).toBeNull();
    expect(r.time.gilmendMinutesPerCase).toBe(3);
  });

  it("can say the time is not saved: a negative saving is reported, not hidden", () => {
    const r = computeRoi(inputs({ manualMinutesPerCase: 2, reviewMinutesPerCase: 5 }), MEASURED);
    expect(r.time.savedMinutesPerCase).toBeLessThan(0);
    expect(r.time.savedHoursPerYear).toBeLessThan(0);
  });
});

describe("bindingWindowHours", () => {
  it("is the real closing time after delivery, from the rules, or null when it only warns", () => {
    expect(bindingWindowHours("mondial_relay")).toBe(72);
    expect(bindingWindowHours("chronopost")).toBe(72);
    expect(bindingWindowHours("colissimo")).toBeNull();
  });
});
