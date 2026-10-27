import { describe, expect, it } from "vitest";
import rawDemo from "../../../data/demo-cases.json";
import rawOrders from "../../../data/fixtures/orders.json";
import { getOrder } from "../orders";
import { listFixtureOrders } from "../orders/fixtures";
import { loadDemoCases, missingDemoPhotos, parseDemoCases } from "./demo-cases";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const HOUR = 3_600_000;

describe("demo cases", () => {
  const cases = loadDemoCases(NOW);

  it("holds the six cases of the spec", () => {
    expect(cases).toHaveLength(6);
    expect(cases.map((c) => c.id)).toEqual([
      "demo-1-vase-broken",
      "demo-2-carton-crushed",
      "demo-3-photo-blurry",
      "demo-4-opened-missing",
      "demo-5-expensive-escalation",
      "demo-6-late-report",
    ]);
  });

  it("covers every outcome of the spec: reship+claim, no action, ask photos, escalation, late refund", () => {
    const byId = Object.fromEntries(cases.map((c) => [c.id, c.expected]));
    expect(byId["demo-1-vase-broken"]).toMatchObject({ decision: "reship", carrierClaim: true, needsHuman: false });
    expect(byId["demo-2-carton-crushed"]).toMatchObject({ decision: "no_action", carrierClaim: false });
    expect(byId["demo-3-photo-blurry"]).toMatchObject({ decision: "ask_more_photos" });
    expect(byId["demo-4-opened-missing"]).toMatchObject({ carrierClaim: true });
    expect(byId["demo-5-expensive-escalation"]).toMatchObject({ needsHuman: true });
    expect(byId["demo-6-late-report"]).toMatchObject({ carrierClaim: false, claimEligible: false });
  });

  it("targets the right carriers: Colissimo, Mondial Relay (72 h case), Chronopost", () => {
    const carrierOf = (id: string) => {
      const c = cases.find((x) => x.id === id)!;
      return listFixtureOrders(NOW).find((o) => o.id === `#${c.report.orderNumber.replace("#", "")}`)!.carrier;
    };
    expect(carrierOf("demo-1-vase-broken")).toBe("colissimo");
    expect(carrierOf("demo-4-opened-missing")).toBe("mondial_relay");
    expect(carrierOf("demo-5-expensive-escalation")).toBe("chronopost");
  });

  it("every case resolves to an existing order with the right e-mail, through getOrder", async () => {
    for (const c of cases) {
      const order = await getOrder(c.report.orderNumber, c.report.customerEmail, { env: {}, now: NOW });
      expect(order, c.id).not.toBeNull();
    }
  });

  it("every report is received after its order was delivered, and not in the future", async () => {
    for (const c of cases) {
      const order = (await getOrder(c.report.orderNumber, c.report.customerEmail, { env: {}, now: NOW }))!;
      const received = Date.parse(c.report.receivedAt);
      expect(received, c.id).toBeGreaterThan(Date.parse(order.deliveredAt!));
      expect(received, c.id).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("the timings give the deadlines the story needs", async () => {
    const delay = async (id: string) => {
      const c = cases.find((x) => x.id === id)!;
      const order = (await getOrder(c.report.orderNumber, c.report.customerEmail, { env: {}, now: NOW }))!;
      return (Date.parse(c.report.receivedAt) - Date.parse(order.deliveredAt!)) / HOUR;
    };
    // Mondial Relay: reported well inside the 72 h window.
    expect(await delay("demo-4-opened-missing")).toBeLessThan(72);
    // Chronopost: reported long after the 3-day (72 h) deadline.
    expect(await delay("demo-6-late-report")).toBeGreaterThan(72 * 2);
    // The others are fresh reports.
    for (const id of ["demo-1-vase-broken", "demo-2-carton-crushed", "demo-3-photo-blurry", "demo-5-expensive-escalation"]) {
      expect(await delay(id), id).toBeLessThan(48);
    }
  });

  it("the expensive item is above the 250 EUR Chronopost default cap and claims no insured value", () => {
    const order = rawOrders.orders.find((o) => o.id === "#1005")!;
    expect(order.lineItems[0].unitPrice).toBeGreaterThan(250);
    // Insurance (ad valorem) is not modelled by the rules: a "declared value 500 EUR" in the
    // service name next to a 250 EUR compensation contradicted itself on the same PDF page.
    expect(order.service).not.toMatch(/declared|insur|assur/i);
  });

  it("each case has one photo path under data/photos, all distinct", () => {
    const photos = cases.flatMap((c) => c.report.photos);
    expect(photos).toHaveLength(6);
    expect(new Set(photos).size).toBe(6);
    for (const p of photos) expect(p).toMatch(/^data\/photos\/[a-z0-9-]+\.jpg$/);
  });

  it("mixes languages: one customer writes in French", () => {
    expect(cases.filter((c) => c.report.language === "fr")).toHaveLength(1);
  });

  it("keeps reports relative to now", () => {
    const later = loadDemoCases(new Date(NOW.getTime() + 24 * HOUR));
    expect(Date.parse(later[0].report.receivedAt) - Date.parse(cases[0].report.receivedAt)).toBe(24 * HOUR);
  });

  it("missingDemoPhotos lists photos not shot yet", () => {
    expect(missingDemoPhotos("/nonexistent-root", cases)).toHaveLength(6);
  });

  describe("parseDemoCases rejects bad data", () => {
    const base = rawDemo.cases[0];
    const withChange = (patch: Record<string, unknown>) =>
      parseDemoCases({ cases: [{ ...base, ...patch }] }, NOW);

    it("a photo outside data/photos", () => {
      expect(() => withChange({ photos: ["../secret.jpg"] })).toThrow(/photos/);
    });
    it("more than three photos", () => {
      const p = "data/photos/a.jpg";
      expect(() => withChange({ photos: [p, p, p, p] })).toThrow(/photos/);
    });
    it("an expected decision missing from acceptableDecisions", () => {
      expect(() =>
        withChange({ expected: { ...base.expected, decision: "refund", acceptableDecisions: ["reship"] } }),
      ).toThrow(/acceptableDecisions/);
    });
    it("a negative offset", () => {
      expect(() => withChange({ reportedHoursAgo: -1 })).toThrow(/reportedHoursAgo/);
    });
    it("a duplicate id", () => {
      expect(() => parseDemoCases({ cases: [base, base] }, NOW)).toThrow(/duplicate/);
    });
  });
});
