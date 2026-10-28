import { describe, expect, it } from "vitest";
import rawFixtures from "../../../data/fixtures/orders.json";
import type { CarrierId } from "../types";
import { listFixtureOrders, loadFixtureOrders, parseFixtureOrders } from "./fixtures";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const HOUR = 3_600_000;

describe("fixture orders", () => {
  it("the bundled file validates and holds 8 to 11 orders", () => {
    const fixtures = loadFixtureOrders();
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    expect(fixtures.length).toBeLessThanOrEqual(11);
  });

  it("covers the three carriers, two orders each at least", () => {
    const counts = new Map<CarrierId, number>();
    for (const o of listFixtureOrders(NOW)) counts.set(o.carrier, (counts.get(o.carrier) ?? 0) + 1);
    for (const carrier of ["colissimo", "mondial_relay", "chronopost"] as const) {
      expect(counts.get(carrier) ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it("holds the German order of the Europe lot: DHL Paket, within Germany, delivered, with a fictitious customer", () => {
    const order = listFixtureOrders(NOW).find((o) => o.id === "#1011")!;
    expect(order).toMatchObject({
      carrier: "dhl_paket",
      service: "DHL Paket",
      currency: "EUR",
      email: "jonas.weber@example.org",
      shippingAddress: { city: "Hamburg", country: "DE" },
    });
    expect(order.deliveredAt).not.toBeNull();
    expect(order.lineItems).toHaveLength(1);
    // The demo case reports it 3 h ago: the order must have been delivered before that (a test of
    // demo-cases.test.ts checks it for every case; this keeps the German one honest on its own).
    expect(Date.parse(order.deliveredAt!)).toBeLessThan(NOW.getTime() - 3 * HOUR);
  });

  it("accepts the two German carriers and still rejects an unknown one", () => {
    const base = (carrier: string) => ({
      orders: [
        {
          id: "#2001",
          name: "Test Person",
          email: "test.person@example.com",
          carrier,
          service: "S",
          trackingNumber: "T1",
          weightKg: 1,
          currency: "EUR",
          lineItems: [{ sku: "A", title: "Item", quantity: 1, unitPrice: 10 }],
          shippingEur: 0,
          shippingAddress: { city: "Berlin", country: "DE" },
          timing: { orderedHoursAgo: 10, deliveredHoursAgo: 2 },
        },
      ],
    });
    expect(parseFixtureOrders(base("dhl_paket"))[0].carrier).toBe("dhl_paket");
    expect(parseFixtureOrders(base("gls"))[0].carrier).toBe("gls");
    expect(() => parseFixtureOrders(base("ups"))).toThrow(/unknown carrier "ups"/);
  });

  it("only uses reserved example domains, so no fixture is a real mailbox", () => {
    for (const o of listFixtureOrders(NOW)) expect(o.email).toMatch(/@example\.(com|org|net)$/);
  });

  it("resolves delivery and order dates relative to now", () => {
    const order = listFixtureOrders(NOW).find((o) => o.id === "#1004");
    expect(order).toBeDefined();
    expect(Date.parse(order!.deliveredAt!)).toBe(NOW.getTime() - 30 * HOUR);
    expect(Date.parse(order!.createdAt)).toBe(NOW.getTime() - 126 * HOUR);
  });

  it("keeps the same relative age when the clock moves (deadlines stay meaningful)", () => {
    const later = new Date(NOW.getTime() + 5 * 24 * HOUR);
    const a = listFixtureOrders(NOW).find((o) => o.id === "#1001")!;
    const b = listFixtureOrders(later).find((o) => o.id === "#1001")!;
    expect(NOW.getTime() - Date.parse(a.deliveredAt!)).toBe(later.getTime() - Date.parse(b.deliveredAt!));
  });

  it("has one order still in transit (deliveredAt null) and delivered ones before now", () => {
    const orders = listFixtureOrders(NOW);
    expect(orders.filter((o) => o.deliveredAt === null)).toHaveLength(1);
    for (const o of orders) {
      expect(Date.parse(o.createdAt)).toBeLessThan(o.deliveredAt ? Date.parse(o.deliveredAt) : NOW.getTime());
      if (o.deliveredAt) expect(Date.parse(o.deliveredAt)).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("computes the total as line items plus shipping, in realistic EUR", () => {
    const raw = rawFixtures.orders;
    for (const o of listFixtureOrders(NOW)) {
      const source = raw.find((r) => r.id === o.id)!;
      const subtotal = o.lineItems.reduce((s, li) => s + li.unitPrice * li.quantity, 0);
      expect(o.total).toBeCloseTo(subtotal + source.shippingEur, 2);
      expect(o.currency).toBe("EUR");
      expect(o.total).toBeGreaterThan(20);
      expect(o.total).toBeLessThan(500);
      expect(o.weightKg).toBeGreaterThan(0.3);
      expect(o.weightKg).toBeLessThan(10);
    }
  });

  it("has unique order ids and tracking numbers", () => {
    const orders = listFixtureOrders(NOW);
    expect(new Set(orders.map((o) => o.id)).size).toBe(orders.length);
    expect(new Set(orders.map((o) => o.trackingNumber)).size).toBe(orders.length);
  });

  describe("parseFixtureOrders rejects bad data", () => {
    const base = rawFixtures.orders[0];
    const withChange = (patch: Record<string, unknown>) =>
      parseFixtureOrders({ orders: [{ ...base, ...patch }] });

    it("accepts the unchanged first order", () => {
      expect(withChange({})).toHaveLength(1);
    });
    it("a non-fictitious e-mail domain", () => {
      expect(() => withChange({ email: "real.person@gmail.com" })).toThrow(/example/);
    });
    it("an unknown carrier", () => {
      expect(() => withChange({ carrier: "ups" })).toThrow(/carrier/);
    });
    it("a delivery before the order", () => {
      expect(() =>
        withChange({ timing: { orderedHoursAgo: 5, deliveredHoursAgo: 10 } }),
      ).toThrow(/ordered before/);
    });
    it("an empty line item list", () => {
      expect(() => withChange({ lineItems: [] })).toThrow(/lineItems/);
    });
    it("a duplicate id", () => {
      expect(() => parseFixtureOrders({ orders: [base, base] })).toThrow(/duplicate/);
    });
    it("a file without orders", () => {
      expect(() => parseFixtureOrders({})).toThrow(/orders/);
    });
  });
});
