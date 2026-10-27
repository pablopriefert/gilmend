import fixtureFile from "../../../data/fixtures/orders.json";
import type { CarrierId, Order, OrderLineItem } from "../types";

// Fictitious orders (data/fixtures/orders.json) used when no Shopify store is configured,
// and as the source of the Shopify seed script. Dates are stored as "hours ago" and
// resolved against `now` at load time: a parcel delivered "20 hours ago" is still
// delivered 20 hours ago on demo day, so carrier deadlines never silently expire.

export interface FixtureOrder
  extends Omit<Order, "createdAt" | "deliveredAt" | "total"> {
  /** Shipping fee in the order currency; added to the line items to get the order total. */
  shippingEur: number;
  timing: {
    orderedHoursAgo: number;
    /** null = still in transit. */
    deliveredHoursAgo: number | null;
  };
}

const CARRIERS: readonly CarrierId[] = ["colissimo", "mondial_relay", "chronopost"];
const HOUR_MS = 3_600_000;

// Reserved documentation domains only: a fixture can never be a real person's mailbox.
const FICTITIOUS_EMAIL = /^[a-z0-9._-]+@example\.(com|org|net)$/i;

function fail(index: number, message: string): never {
  throw new Error(`Invalid fixture order at index ${index}: ${message}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(o: Record<string, unknown>, key: string, i: number): string {
  const v = o[key];
  if (typeof v !== "string" || v.trim() === "") fail(i, `"${key}" must be a non-empty string`);
  return v;
}

function num(o: Record<string, unknown>, key: string, i: number, min = 0): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) {
    fail(i, `"${key}" must be a number >= ${min}`);
  }
  return v;
}

/** Validates the raw JSON (unknown shape) and returns typed fixture orders. */
export function parseFixtureOrders(raw: unknown): FixtureOrder[] {
  const list = isRecord(raw) ? raw.orders : raw;
  if (!Array.isArray(list)) throw new Error("Fixture file must contain an 'orders' array");
  const seen = new Set<string>();

  return list.map((entry, i) => {
    if (!isRecord(entry)) return fail(i, "not an object");
    const id = str(entry, "id", i);
    if (!/^#\d{3,10}$/.test(id)) fail(i, `id "${id}" must look like "#1001"`);
    if (seen.has(id)) fail(i, `duplicate id ${id}`);
    seen.add(id);

    const email = str(entry, "email", i);
    if (!FICTITIOUS_EMAIL.test(email)) {
      fail(i, `e-mail of ${id} must be on example.com/.org/.net (fictitious data only)`);
    }
    const carrier = str(entry, "carrier", i) as CarrierId;
    if (!CARRIERS.includes(carrier)) fail(i, `unknown carrier "${carrier}"`);

    if (!Array.isArray(entry.lineItems) || entry.lineItems.length === 0) {
      fail(i, "lineItems must be a non-empty array");
    }
    const lineItems: OrderLineItem[] = entry.lineItems.map((li: unknown) => {
      if (!isRecord(li)) return fail(i, "line item is not an object");
      const quantity = num(li, "quantity", i, 1);
      if (!Number.isInteger(quantity)) fail(i, "quantity must be an integer");
      return {
        sku: str(li, "sku", i),
        title: str(li, "title", i),
        quantity,
        unitPrice: num(li, "unitPrice", i, 0.01),
      };
    });

    const address = entry.shippingAddress;
    if (!isRecord(address)) return fail(i, "shippingAddress missing");
    const timing = entry.timing;
    if (!isRecord(timing)) return fail(i, "timing missing");
    const orderedHoursAgo = num(timing, "orderedHoursAgo", i, 0);
    const deliveredHoursAgo =
      timing.deliveredHoursAgo === null ? null : num(timing, "deliveredHoursAgo", i, 0);
    if (deliveredHoursAgo !== null && orderedHoursAgo <= deliveredHoursAgo) {
      fail(i, `${id} must be ordered before it is delivered`);
    }

    return {
      id,
      name: str(entry, "name", i),
      email,
      carrier,
      service: str(entry, "service", i),
      trackingNumber: str(entry, "trackingNumber", i),
      weightKg: num(entry, "weightKg", i, 0.01),
      currency: str(entry, "currency", i),
      lineItems,
      shippingEur: num(entry, "shippingEur", i, 0),
      shippingAddress: {
        city: str(address, "city", i),
        country: str(address, "country", i),
      },
      timing: { orderedHoursAgo, deliveredHoursAgo },
    };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Turn a fixture into a regular Order, resolving the hour offsets against `now`. */
export function resolveFixtureOrder(f: FixtureOrder, now: Date): Order {
  const { shippingEur, timing, ...rest } = f;
  const subtotal = f.lineItems.reduce((sum, li) => sum + li.unitPrice * li.quantity, 0);
  return {
    ...rest,
    createdAt: new Date(now.getTime() - timing.orderedHoursAgo * HOUR_MS).toISOString(),
    deliveredAt:
      timing.deliveredHoursAgo === null
        ? null
        : new Date(now.getTime() - timing.deliveredHoursAgo * HOUR_MS).toISOString(),
    total: round2(subtotal + shippingEur),
  };
}

let cached: FixtureOrder[] | null = null;

/** The bundled fictitious orders, validated once per process. */
export function loadFixtureOrders(): FixtureOrder[] {
  cached ??= parseFixtureOrders(fixtureFile);
  return cached;
}

/** All fictitious orders with dates relative to `now` (default: the current time). */
export function listFixtureOrders(now: Date = new Date()): Order[] {
  return loadFixtureOrders().map((f) => resolveFixtureOrder(f, now));
}
