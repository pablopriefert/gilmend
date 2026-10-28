import { describe, expect, it, vi } from "vitest";
import {
  fetchOrderFromShopify,
  mapShopifyOrder,
  normalizeShopDomain,
  OrderDataError,
  ShopifyError,
  shopifyGraphQL,
  SHOPIFY_API_VERSION,
  type ShopifyConfig,
  type ShopifyOrderNode,
} from "./shopify";

const config: ShopifyConfig = { shopDomain: "dd-dev.myshopify.com", accessToken: "shpat_secret-factice" };

function node(overrides: Partial<ShopifyOrderNode> = {}): ShopifyOrderNode {
  return {
    name: "#1001",
    email: "camille.laurent@example.com",
    createdAt: "2026-10-26T08:00:00Z",
    currencyCode: "EUR",
    tags: [],
    totalWeight: 2000,
    totalPriceSet: { shopMoney: { amount: "64.90", currencyCode: "EUR" } },
    shippingAddress: { name: "Camille Laurent", city: "Lyon", country: "France" },
    shippingLines: { nodes: [{ title: "Colissimo Domicile sans signature", code: "colissimo" }] },
    fulfillments: [],
    lineItems: {
      nodes: [
        { sku: "VASE-TALL-SAND", title: "Hand-thrown stoneware vase, tall", quantity: 1, originalUnitPriceSet: { shopMoney: { amount: "58.00" } } },
      ],
    },
    mfCarrier: null,
    mfService: null,
    mfWeight: null,
    mfTracking: null,
    mfDelivered: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("shopifyGraphQL request shape", () => {
  it("POSTs to the versioned Admin endpoint with the token header and variables", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { ok: true } }));
    const data = await shopifyGraphQL<{ ok: boolean }>(config, "query { shop { name } }", { a: 1 }, fetchImpl);
    expect(data.ok).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://dd-dev.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`);
    expect(SHOPIFY_API_VERSION).toBe("2026-10");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Shopify-Access-Token"]).toBe(config.accessToken);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ query: "query { shop { name } }", variables: { a: 1 } });
  });

  it("never puts the token in an error message", async () => {
    const unauthorized = vi.fn(async () => jsonResponse({ errors: "[API] Invalid API key" }, 401));
    await expect(shopifyGraphQL(config, "q", {}, unauthorized)).rejects.toThrow(/HTTP 401/);
    await expect(shopifyGraphQL(config, "q", {}, unauthorized)).rejects.not.toThrow(/secret-factice/);

    const broken = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const err = await shopifyGraphQL(config, "q", {}, broken).catch((e: Error) => e);
    expect(err).toBeInstanceOf(ShopifyError);
    expect((err as Error).message).not.toContain("secret-factice");
  });

  it("surfaces GraphQL errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: [{ message: "Throttled" }] }));
    await expect(shopifyGraphQL(config, "q", {}, fetchImpl)).rejects.toThrow(/Throttled/);
  });

  it("normalizes the shop domain and refuses foreign hosts", () => {
    expect(normalizeShopDomain("https://Dd-Dev.myshopify.com/")).toBe("dd-dev.myshopify.com");
    expect(() => normalizeShopDomain("dd-dev.myshopify.com.evil.io")).toThrow();
    expect(() => normalizeShopDomain("localhost:3000")).toThrow();
  });
});

describe("fetchOrderFromShopify", () => {
  it("searches by name and e-mail through variables, then maps the order", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { orders: { nodes: [node({ mfCarrier: { value: "colissimo" } })] } } }),
    );
    const order = await fetchOrderFromShopify("1001", "Camille.Laurent@example.com", config, fetchImpl);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.variables).toEqual({ query: "name:#1001 email:Camille.Laurent@example.com" });
    expect(body.query).toContain("orders(first: 5, query: $query)");
    expect(body.query).not.toContain("camille");

    expect(order).toMatchObject({
      id: "#1001",
      name: "Camille Laurent",
      carrier: "colissimo",
      service: "Colissimo Domicile sans signature",
      weightKg: 2,
      currency: "EUR",
      total: 64.9,
      deliveredAt: null,
      shippingAddress: { city: "Lyon", country: "France" },
    });
    expect(order?.lineItems).toEqual([
      { sku: "VASE-TALL-SAND", title: "Hand-thrown stoneware vase, tall", quantity: 1, unitPrice: 58 },
    ]);
  });

  it("returns null when the e-mail of the returned order differs (fuzzy search guard)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { orders: { nodes: [node({ email: "someone.else@example.com" })] } } }),
    );
    expect(await fetchOrderFromShopify("#1001", "camille.laurent@example.com", config, fetchImpl)).toBeNull();
  });

  it("returns null when the order name differs", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { orders: { nodes: [node({ name: "#1011" })] } } }),
    );
    expect(await fetchOrderFromShopify("#1001", "camille.laurent@example.com", config, fetchImpl)).toBeNull();
  });

  it("does not call Shopify for malformed input", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchOrderFromShopify("1001 OR 1", "camille.laurent@example.com", config, fetchImpl)).toBeNull();
    expect(await fetchOrderFromShopify("#1001", "not an email", config, fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("mapShopifyOrder data convention", () => {
  it("carrier: metafield wins over tag, tracking company and shipping line", () => {
    const o = mapShopifyOrder(
      node({
        mfCarrier: { value: "Mondial Relay" },
        tags: ["dd-carrier:chronopost"],
        shippingLines: { nodes: [{ title: "Colissimo", code: null }] },
      }),
    );
    expect(o.carrier).toBe("mondial_relay");
  });

  it("carrier: tag, then tracking company, then shipping line title", () => {
    expect(mapShopifyOrder(node({ tags: ["x", "dd-carrier:chronopost"] })).carrier).toBe("chronopost");
    expect(
      mapShopifyOrder(
        node({
          shippingLines: { nodes: [{ title: "Standard", code: null }] },
          fulfillments: [{ deliveredAt: null, trackingInfo: [{ number: "1", company: "Mondial Relay" }] }],
        }),
      ).carrier,
    ).toBe("mondial_relay");
    expect(
      mapShopifyOrder(node({ shippingLines: { nodes: [{ title: "Chrono 13 express", code: null }] } })).carrier,
    ).toBe("chronopost");
  });

  it("carrier: finds DHL Paket and GLS from the metafield, the tag, the tracking company or the shipping line", () => {
    expect(mapShopifyOrder(node({ mfCarrier: { value: "DHL Paket" } })).carrier).toBe("dhl_paket");
    expect(mapShopifyOrder(node({ tags: ["dd-carrier:gls"] })).carrier).toBe("gls");
    expect(
      mapShopifyOrder(
        node({
          shippingLines: { nodes: [{ title: "Standard", code: null }] },
          fulfillments: [{ deliveredAt: null, trackingInfo: [{ number: "1", company: "GLS" }] }],
        }),
      ).carrier,
    ).toBe("gls");
    expect(mapShopifyOrder(node({ shippingLines: { nodes: [{ title: "DHL Paket Standard", code: null }] } })).carrier).toBe("dhl_paket");
    expect(mapShopifyOrder(node({ shippingLines: { nodes: [{ title: "General Logistics Systems", code: null }] } })).carrier).toBe("gls");
  });

  it("carrier: a bare 'DHL' is not enough (DHL Express and eCommerce follow other terms), and 'GLS' is a whole word", () => {
    const n = (title: string) => node({ shippingLines: { nodes: [{ title, code: null }] } });
    expect(() => mapShopifyOrder(n("DHL"))).toThrow(OrderDataError);
    expect(() => mapShopifyOrder(n("DHL Express Worldwide"))).toThrow(OrderDataError);
    expect(() => mapShopifyOrder(n("Wiegls Lieferung"))).toThrow(OrderDataError);
  });

  it("throws OrderDataError, naming the fix, when no carrier can be found", () => {
    const n = node({ shippingLines: { nodes: [{ title: "Standard", code: "std" }] } });
    expect(() => mapShopifyOrder(n)).toThrow(OrderDataError);
    expect(() => mapShopifyOrder(n)).toThrow(/damage_desk\.carrier/);
  });

  it("weight: parcel_weight_kg metafield wins over totalWeight (grams)", () => {
    expect(mapShopifyOrder(node({ mfWeight: { value: "2.35" } })).weightKg).toBe(2.35);
    expect(mapShopifyOrder(node({ totalWeight: "1500" })).weightKg).toBe(1.5);
  });

  it("throws OrderDataError when there is no weight at all", () => {
    expect(() => mapShopifyOrder(node({ totalWeight: null }))).toThrow(/parcel_weight_kg/);
    expect(() => mapShopifyOrder(node({ totalWeight: 0 }))).toThrow(OrderDataError);
  });

  it("tracking and delivery: fulfillment first, metafields as fallback, else empty / null", () => {
    const fromFulfillment = mapShopifyOrder(
      node({
        fulfillments: [
          { deliveredAt: "2026-10-29T10:00:00Z", trackingInfo: [{ number: "6A111", company: "Colissimo" }] },
        ],
        mfTracking: { value: "IGNORED" },
        mfDelivered: { value: "2026-10-01T00:00:00Z" },
      }),
    );
    expect(fromFulfillment.trackingNumber).toBe("6A111");
    expect(fromFulfillment.deliveredAt).toBe("2026-10-29T10:00:00.000Z");

    const fromMetafields = mapShopifyOrder(
      node({ mfTracking: { value: "6A222" }, mfDelivered: { value: "2026-10-29T10:00:00Z" } }),
    );
    expect(fromMetafields.trackingNumber).toBe("6A222");
    expect(fromMetafields.deliveredAt).toBe("2026-10-29T10:00:00.000Z");

    const none = mapShopifyOrder(node());
    expect(none.trackingNumber).toBe("");
    expect(none.deliveredAt).toBeNull();
  });

  it("service: metafield, then shipping line title, then carrier id", () => {
    expect(mapShopifyOrder(node({ mfService: { value: "Colissimo Domicile avec signature" } })).service).toBe(
      "Colissimo Domicile avec signature",
    );
    expect(mapShopifyOrder(node()).service).toBe("Colissimo Domicile sans signature");
    expect(
      mapShopifyOrder(node({ shippingLines: { nodes: [] }, mfCarrier: { value: "colissimo" } })).service,
    ).toBe("colissimo");
  });
});
