import type { Env } from "../config";
import type { Order } from "../types";
import { loadFixtureOrders, resolveFixtureOrder } from "./fixtures";
import { emailsMatch, normalizeOrderNumber } from "./match";
import {
  fetchOrderFromShopify,
  normalizeShopDomain,
  ShopifyConfigError,
  type ShopifyConfig,
} from "./shopify";

export { listFixtureOrders } from "./fixtures";
export { OrderDataError, ShopifyConfigError, ShopifyError } from "./shopify";

export type OrderSource = "shopify" | "fixtures";

export interface GetOrderOptions {
  env?: Env;
  /** Clock used to resolve fixture dates (tests pin it). */
  now?: Date;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Shopify credentials from the environment, or null when the store is not connected.
 * SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN are the canonical names; the older
 * SHOPIFY_SHOP_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN of .env.example are accepted too.
 * Only one of the two set is a misconfiguration and throws, instead of silently serving
 * fixtures to someone who believes the store is connected.
 */
export function getShopifyConfig(env: Env = process.env): ShopifyConfig | null {
  const domain = (env.SHOPIFY_STORE_DOMAIN || env.SHOPIFY_SHOP_DOMAIN || "").trim();
  const token = (env.SHOPIFY_ADMIN_TOKEN || env.SHOPIFY_ADMIN_ACCESS_TOKEN || "").trim();
  if (!domain && !token) return null;
  if (!domain || !token) {
    throw new ShopifyConfigError(
      "Shopify is half configured: set both SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN, or neither.",
    );
  }
  return { shopDomain: normalizeShopDomain(domain), accessToken: token };
}

/** Where getOrder reads from; the UI shows it so fictitious data is never mistaken for a store. */
export function getOrderSource(env: Env = process.env): OrderSource {
  return getShopifyConfig(env) ? "shopify" : "fixtures";
}

let loggedFixtures = false;

/**
 * Look an order up by the number the customer quotes and their e-mail (both must match,
 * so one customer cannot read another's order). Shopify dev store when configured,
 * fictitious data/fixtures/orders.json otherwise. Returns null when nothing matches.
 * A Shopify failure throws (it is NOT silently replaced by fixtures: the agent must see
 * that the store was unreachable rather than "order not found").
 */
export async function getOrder(
  orderNumber: string,
  email: string,
  options: GetOrderOptions = {},
): Promise<Order | null> {
  const config = getShopifyConfig(options.env ?? process.env);
  if (config) return fetchOrderFromShopify(orderNumber, email, config, options.fetchImpl);

  if (!loggedFixtures) {
    loggedFixtures = true;
    console.info("[orders] Shopify not configured: using FICTITIOUS fixture orders (data/fixtures/orders.json).");
  }
  const wanted = normalizeOrderNumber(orderNumber);
  if (!wanted) return null;
  const fixture = loadFixtureOrders().find(
    (f) => f.id.toUpperCase() === wanted && emailsMatch(f.email, email),
  );
  return fixture ? resolveFixtureOrder(fixture, options.now ?? new Date()) : null;
}
