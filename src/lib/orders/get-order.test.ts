import { describe, expect, it, vi } from "vitest";
import { getOrder, getOrderSource, getShopifyConfig } from "./index";
import { emailsMatch, normalizeEmail, normalizeOrderNumber } from "./match";
import { ShopifyConfigError } from "./shopify";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const noShopify = { env: {}, now: NOW };

describe("getOrder (fixtures)", () => {
  it("finds an order by number and e-mail", async () => {
    const order = await getOrder("#1001", "camille.laurent@example.com", noShopify);
    expect(order?.id).toBe("#1001");
    expect(order?.carrier).toBe("colissimo");
    expect(order?.deliveredAt).toBe(new Date(NOW.getTime() - 20 * 3_600_000).toISOString());
  });

  it("matches the e-mail case-insensitively and ignores surrounding spaces", async () => {
    const order = await getOrder("#1002", "  Hugo.Bernard@Example.COM ", noShopify);
    expect(order?.id).toBe("#1002");
  });

  it("accepts the number without '#', as customers type it", async () => {
    const order = await getOrder("1003", "ines.moreau@example.org", noShopify);
    expect(order?.id).toBe("#1003");
  });

  it("returns null for a wrong e-mail (no order leak between customers)", async () => {
    expect(await getOrder("#1001", "hugo.bernard@example.com", noShopify)).toBeNull();
  });

  it("returns null for an unknown order", async () => {
    expect(await getOrder("#9999", "camille.laurent@example.com", noShopify)).toBeNull();
  });

  it("returns null for input that cannot be an order number", async () => {
    expect(await getOrder("1001 OR 1002", "camille.laurent@example.com", noShopify)).toBeNull();
    expect(await getOrder("", "camille.laurent@example.com", noShopify)).toBeNull();
  });

  it("never calls the network when Shopify is not configured", async () => {
    const fetchImpl = vi.fn();
    await getOrder("#1001", "camille.laurent@example.com", { ...noShopify, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("an in-transit order has no delivery date", async () => {
    const order = await getOrder("#1009", "nora.haddad@example.com", noShopify);
    expect(order?.deliveredAt).toBeNull();
  });
});

describe("Shopify configuration", () => {
  it("is off when both variables are empty (as in .env.example)", () => {
    expect(getShopifyConfig({ SHOPIFY_STORE_DOMAIN: "", SHOPIFY_ADMIN_TOKEN: "" })).toBeNull();
    expect(getOrderSource({})).toBe("fixtures");
  });

  it("is on when domain and token are set, with either variable naming", () => {
    const a = getShopifyConfig({ SHOPIFY_STORE_DOMAIN: "dd-dev.myshopify.com", SHOPIFY_ADMIN_TOKEN: "t" });
    const b = getShopifyConfig({
      SHOPIFY_SHOP_DOMAIN: "https://dd-dev.myshopify.com/",
      SHOPIFY_ADMIN_ACCESS_TOKEN: "t",
    });
    expect(a).toEqual({ shopDomain: "dd-dev.myshopify.com", accessToken: "t" });
    expect(b).toEqual(a);
    expect(getOrderSource({ SHOPIFY_STORE_DOMAIN: "dd-dev.myshopify.com", SHOPIFY_ADMIN_TOKEN: "t" })).toBe("shopify");
  });

  it("throws when only one of the two is set", () => {
    expect(() => getShopifyConfig({ SHOPIFY_STORE_DOMAIN: "dd-dev.myshopify.com" })).toThrow(ShopifyConfigError);
    expect(() => getShopifyConfig({ SHOPIFY_ADMIN_TOKEN: "t" })).toThrow(ShopifyConfigError);
  });

  it("refuses a domain that is not *.myshopify.com (the token is sent there)", () => {
    expect(() =>
      getShopifyConfig({ SHOPIFY_STORE_DOMAIN: "evil.example.com", SHOPIFY_ADMIN_TOKEN: "t" }),
    ).toThrow(/myshopify/);
  });

  it("uses Shopify instead of fixtures once configured", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: { orders: { nodes: [] } } }), { status: 200 }),
    );
    const order = await getOrder("#1001", "camille.laurent@example.com", {
      env: { SHOPIFY_STORE_DOMAIN: "dd-dev.myshopify.com", SHOPIFY_ADMIN_TOKEN: "t" },
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(order).toBeNull();
  });
});

describe("matching helpers", () => {
  it("normalizeOrderNumber", () => {
    expect(normalizeOrderNumber("#1001")).toBe("#1001");
    expect(normalizeOrderNumber(" 1001 ")).toBe("#1001");
    expect(normalizeOrderNumber("# 1001")).toBe("#1001");
    expect(normalizeOrderNumber("dd-12")).toBe("#DD-12");
    expect(normalizeOrderNumber("1001 OR 1")).toBeNull();
    expect(normalizeOrderNumber("")).toBeNull();
    expect(normalizeOrderNumber("#".repeat(3))).toBeNull();
  });

  it("emailsMatch / normalizeEmail", () => {
    expect(emailsMatch("A@B.fr", " a@b.FR ")).toBe(true);
    expect(emailsMatch("a@b.fr", "a+x@b.fr")).toBe(false);
    expect(emailsMatch(null, "a@b.fr")).toBe(false);
    expect(normalizeEmail("a@b.fr")).toBe("a@b.fr");
    expect(normalizeEmail("a b@c.fr")).toBeNull();
    expect(normalizeEmail("nope")).toBeNull();
  });
});
