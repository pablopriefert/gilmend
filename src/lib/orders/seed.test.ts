import { describe, expect, it, vi } from "vitest";
import { listFixtureOrders, loadFixtureOrders } from "./fixtures";
import { buildDraftOrderInput, buildOrderMetafields, fixtureTag, runSeed } from "./seed";
import type { ShopifyConfig } from "./shopify";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const config: ShopifyConfig = { shopDomain: "dd-dev.myshopify.com", accessToken: "tok-factice" };
const orders = listFixtureOrders(NOW).slice(0, 2);
const shippingEurById = Object.fromEntries(loadFixtureOrders().map((f) => [f.id, f.shippingEur]));

/** A fake Admin API that answers by operation name and records the calls. */
function fakeShopify(
  opts: { partnerDevelopment?: boolean; existing?: Set<string>; firstOrderNumber?: number } = {},
) {
  const calls: { op: string; variables: Record<string, unknown> }[] = [];
  // Shopify numbers orders itself: the first order of a fresh store is #1001.
  let counter = (opts.firstOrderNumber ?? 1001) - 1;
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const { query, variables } = JSON.parse(init?.body as string) as {
      query: string;
      variables: Record<string, unknown>;
    };
    const op = /(?:query|mutation) (\w+)/.exec(query)![1];
    calls.push({ op, variables });
    let data: unknown;
    switch (op) {
      case "SeedShop":
        data = {
          shop: {
            name: "DD",
            myshopifyDomain: "dd-dev.myshopify.com",
            plan: { partnerDevelopment: opts.partnerDevelopment ?? true },
          },
        };
        break;
      case "SeedFind": {
        const tag = String(variables.query).replace("tag:", "");
        data = { orders: { nodes: opts.existing?.has(tag) ? [{ name: "#9000" }] : [] } };
        break;
      }
      case "SeedDraftCreate":
        data = { draftOrderCreate: { draftOrder: { id: `gid://shopify/DraftOrder/${++counter}` }, userErrors: [] } };
        break;
      case "SeedDraftComplete":
        data = {
          draftOrderComplete: {
            draftOrder: { order: { id: `gid://shopify/Order/${counter}`, name: `#${counter}` } },
            userErrors: [],
          },
        };
        break;
      case "SeedMetafields":
        data = { metafieldsSet: { metafields: [{ id: "m" }], userErrors: [] } };
        break;
      default:
        throw new Error(`unexpected operation ${op}`);
    }
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  return { fetchImpl, calls };
}

describe("seed payloads", () => {
  it("builds a draft order with custom line items, a shipping line and the carrier tag", () => {
    const order = orders[0];
    const input = buildDraftOrderInput(order, shippingEurById[order.id]);
    expect(input.email).toBe(order.email);
    expect(input.tags).toContain(`dd-carrier:${order.carrier}`);
    expect(input.tags).toContain(fixtureTag(order.id));
    expect(input.lineItems[0]).toMatchObject({
      title: order.lineItems[0].title,
      sku: order.lineItems[0].sku,
      originalUnitPriceWithCurrency: { amount: "58.00", currencyCode: "EUR" },
    });
    expect(input.shippingLine).toEqual({
      title: order.service,
      priceWithCurrency: { amount: "6.90", currencyCode: "EUR" },
    });
    expect(input.shippingAddress).toMatchObject({ firstName: "Camille", lastName: "Laurent", countryCode: "FR" });
  });

  it("writes the convention metafields, with delivered_at only when delivered", () => {
    const delivered = buildOrderMetafields(orders[0]);
    expect(delivered.map((m) => m.key).sort()).toEqual(
      ["carrier", "delivered_at", "parcel_weight_kg", "service", "tracking_number"],
    );
    expect(delivered.every((m) => m.namespace === "damage_desk")).toBe(true);
    expect(delivered.find((m) => m.key === "delivered_at")?.value).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

    const inTransit = listFixtureOrders(NOW).find((o) => o.deliveredAt === null)!;
    expect(buildOrderMetafields(inTransit).some((m) => m.key === "delivered_at")).toBe(false);
  });
});

describe("runSeed", () => {
  it("dry run sends nothing", async () => {
    const { fetchImpl } = fakeShopify();
    const lines: string[] = [];
    const result = await runSeed({
      orders, shippingEurById, config: null, execute: false, fetchImpl, log: (l) => lines.push(l),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.created).toEqual([]);
    expect(lines.join("\n")).toMatch(/dry-run/);
  });

  it("creates, completes and sets metafields for each order, in that order", async () => {
    const { fetchImpl, calls } = fakeShopify();
    const result = await runSeed({ orders, shippingEurById, config, execute: true, fetchImpl });
    expect(calls.map((c) => c.op)).toEqual([
      "SeedShop",
      "SeedFind", "SeedDraftCreate", "SeedDraftComplete", "SeedMetafields",
      "SeedFind", "SeedDraftCreate", "SeedDraftComplete", "SeedMetafields",
    ]);
    expect(result.created).toHaveLength(2);
    const meta = calls.find((c) => c.op === "SeedMetafields")!.variables.metafields as { ownerId: string }[];
    expect(meta.every((m) => m.ownerId.startsWith("gid://shopify/Order/"))).toBe(true);
  });

  it("reports no rename when Shopify numbers the orders like the fixtures (fresh store)", async () => {
    const { fetchImpl } = fakeShopify();
    const result = await runSeed({ orders, shippingEurById, config, execute: true, fetchImpl });
    expect(result.created.map((c) => c.shopifyName)).toEqual(["#1001", "#1002"]);
    expect(result.renamed).toEqual([]);
  });

  it("reports orders whose Shopify name differs from the fixture id (used store)", async () => {
    const { fetchImpl } = fakeShopify({ firstOrderNumber: 1011 });
    const result = await runSeed({ orders, shippingEurById, config, execute: true, fetchImpl });
    expect(result.renamed).toEqual([
      { fixtureId: "#1001", shopifyName: "#1011" },
      { fixtureId: "#1002", shopifyName: "#1012" },
    ]);
  });

  it("skips fixtures already present in the store", async () => {
    const { fetchImpl, calls } = fakeShopify({ existing: new Set([fixtureTag("#1001")]) });
    const result = await runSeed({ orders, shippingEurById, config, execute: true, fetchImpl });
    expect(result.skipped).toEqual(["#1001"]);
    expect(result.created.map((c) => c.fixtureId)).toEqual(["#1002"]);
    expect(calls.filter((c) => c.op === "SeedDraftCreate")).toHaveLength(1);
  });

  it("refuses a store that is not a development store, before any write", async () => {
    const { fetchImpl, calls } = fakeShopify({ partnerDevelopment: false });
    await expect(runSeed({ orders, shippingEurById, config, execute: true, fetchImpl })).rejects.toThrow(
      /not a partner development store/,
    );
    expect(calls.map((c) => c.op)).toEqual(["SeedShop"]);
  });

  it("--execute without credentials fails instead of guessing", async () => {
    await expect(runSeed({ orders, shippingEurById, config: null, execute: true })).rejects.toThrow(/SHOPIFY_SEED_TOKEN/);
  });
});
