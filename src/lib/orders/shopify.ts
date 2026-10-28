import type { CarrierId, Order, OrderLineItem } from "../types";
import { emailsMatch, normalizeEmail, normalizeOrderNumber } from "./match";

// Read-only Shopify Admin GraphQL client for the order lookup tool.
//
// Scope: `read_orders` and nothing else (the app never writes to the store; only the
// separate seed script does, with its own temporary token). Orders older than 60 days
// would need `read_all_orders`; the dev store only holds fresh fictitious orders.
//
// DATA CONVENTION: Shopify has no field for "which carrier / which service / how heavy was
// the packed parcel / when did the carrier deliver it", and a dev store has no carrier
// integration, so the merchant (or our seed script) records it on the order.
// Everything is optional except carrier and weight, and is resolved in this order:
//
//   carrier   metafield damage_desk.carrier  ->  tag "dd-carrier:<id>"
//             ->  fulfillment tracking company  ->  shipping line title/code
//             (<id> is colissimo | mondial_relay | chronopost | dhl_paket | gls)
//   service   metafield damage_desk.service  ->  shipping line title
//   weight    metafield damage_desk.parcel_weight_kg (packed parcel, in kg)
//             ->  order.totalWeight / 1000 (goods only, in grams, no packaging)
//   tracking  fulfillment tracking number  ->  metafield damage_desk.tracking_number
//   delivered fulfillment.deliveredAt (carrier tracking event)
//             ->  metafield damage_desk.delivered_at (ISO 8601)  ->  null (not delivered)

export const SHOPIFY_API_VERSION = "2026-10";
export const METAFIELD_NAMESPACE = "damage_desk";
export const CARRIER_TAG_PREFIX = "dd-carrier:";

export interface ShopifyConfig {
  /** e.g. "damage-desk-dev.myshopify.com" */
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
}

/** Misconfiguration (bad domain, missing half of the credentials). Loud on purpose. */
export class ShopifyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyConfigError";
  }
}

/** Transport or API failure. Never contains the access token. */
export class ShopifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyError";
  }
}

/** The order exists but lacks data the claim needs (carrier, weight). */
export class OrderDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderDataError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

/**
 * Accepts "shop.myshopify.com" (also with https:// or a trailing slash) and refuses
 * anything else: the access token is sent to this host, so it must never be an arbitrary
 * address coming from an env var typo.
 */
export function normalizeShopDomain(input: string): string {
  const domain = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (!SHOP_DOMAIN.test(domain)) {
    throw new ShopifyConfigError(
      `Shopify domain must look like "my-store.myshopify.com" (got "${input}")`,
    );
  }
  return domain.toLowerCase();
}

/**
 * Low-level GraphQL call. `variables` carry every dynamic value, so nothing the customer
 * typed is ever spliced into the query text.
 */
export async function shopifyGraphQL<T>(
  config: ShopifyConfig,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const domain = normalizeShopDomain(config.shopDomain);
  const url = `https://${domain}/admin/api/${config.apiVersion ?? SHOPIFY_API_VERSION}/graphql.json`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Shopify-Access-Token": config.accessToken,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new ShopifyError(`Shopify request failed: ${err instanceof Error ? err.message : "network error"}`);
  }

  if (!response.ok) {
    throw new ShopifyError(`Shopify answered HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    data?: T;
    errors?: { message?: string }[] | string;
  };
  if (body.errors) {
    const detail = Array.isArray(body.errors)
      ? body.errors.map((e) => e.message ?? "unknown error").join("; ")
      : String(body.errors);
    throw new ShopifyError(`Shopify GraphQL error: ${detail}`);
  }
  if (!body.data) throw new ShopifyError("Shopify returned no data");
  return body.data;
}

// --- Order lookup -----------------------------------------------------------------

export const ORDER_LOOKUP_QUERY = /* GraphQL */ `
  query GilmendOrderLookup($query: String!) {
    orders(first: 5, query: $query) {
      nodes {
        name
        email
        createdAt
        currencyCode
        tags
        totalWeight
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { name city country }
        shippingLines(first: 5) { nodes { title code } }
        fulfillments(first: 5) {
          deliveredAt
          trackingInfo(first: 3) { number company }
        }
        lineItems(first: 50) {
          nodes {
            sku
            title
            quantity
            originalUnitPriceSet { shopMoney { amount } }
          }
        }
        mfCarrier: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "carrier") { value }
        mfService: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "service") { value }
        mfWeight: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "parcel_weight_kg") { value }
        mfTracking: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "tracking_number") { value }
        mfDelivered: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "delivered_at") { value }
      }
    }
  }
`;

interface MetafieldValue {
  value: string;
}

/** Shape of one order node returned by ORDER_LOOKUP_QUERY (only what we read). */
export interface ShopifyOrderNode {
  name: string;
  email: string | null;
  createdAt: string;
  currencyCode: string;
  tags: string[];
  totalWeight: string | number | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  shippingAddress: { name: string | null; city: string | null; country: string | null } | null;
  shippingLines: { nodes: { title: string | null; code: string | null }[] };
  fulfillments: {
    deliveredAt: string | null;
    trackingInfo: { number: string | null; company: string | null }[];
  }[];
  lineItems: {
    nodes: {
      sku: string | null;
      title: string;
      quantity: number;
      originalUnitPriceSet: { shopMoney: { amount: string } };
    }[];
  };
  mfCarrier: MetafieldValue | null;
  mfService: MetafieldValue | null;
  mfWeight: MetafieldValue | null;
  mfTracking: MetafieldValue | null;
  mfDelivered: MetafieldValue | null;
}

/** Best-effort carrier detection from free text (carrier name, shipping rate title). */
export function detectCarrier(text: string | null | undefined): CarrierId | null {
  if (!text) return null;
  if (/colissimo|la\s*poste|laposte/i.test(text)) return "colissimo";
  if (/mondial\s*-?\s*relay|mondialrelay/i.test(text)) return "mondial_relay";
  if (/chronopost|chrono\s*(13|18|classic|relais)/i.test(text)) return "chronopost";
  // "DHL" alone is not enough: DHL Express and DHL eCommerce follow other terms than DHL Paket. "DHL
  // Parcel" is not DHL Paket either: it is the brand of DHL's Benelux, UK, Spanish and Polish parcel
  // networks, with their own terms, so it stays unmapped (the merchant sets the carrier by hand). The
  // exact tracking-company string Shopify sends for DHL Germany was not confirmed, hence only the name.
  if (/dhl\s*-?\s*paket/i.test(text)) return "dhl_paket";
  // A bare "GLS" also covers GLS France, Italy or Spain, whose terms are not modelled: the claim is then
  // refused for its destination or left to a person, and computeClaim's message says the rules are GLS
  // Germany's.
  if (/\bgls\b|general\s+logistics\s+systems/i.test(text)) return "gls";
  return null;
}

function asCarrierId(value: string | null | undefined): CarrierId | null {
  const v = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return v === "colissimo" || v === "mondial_relay" || v === "chronopost" || v === "dhl_paket" || v === "gls" ? v : null;
}

function resolveCarrier(node: ShopifyOrderNode): CarrierId | null {
  const fromMetafield = asCarrierId(node.mfCarrier?.value);
  if (fromMetafield) return fromMetafield;

  const tag = node.tags.find((t) => t.toLowerCase().startsWith(CARRIER_TAG_PREFIX));
  const fromTag = tag ? asCarrierId(tag.slice(CARRIER_TAG_PREFIX.length)) : null;
  if (fromTag) return fromTag;

  for (const f of node.fulfillments) {
    for (const t of f.trackingInfo) {
      const fromCompany = detectCarrier(t.company);
      if (fromCompany) return fromCompany;
    }
  }
  for (const line of node.shippingLines.nodes) {
    const fromLine = detectCarrier(line.title) ?? detectCarrier(line.code);
    if (fromLine) return fromLine;
  }
  return null;
}

function resolveWeightKg(node: ShopifyOrderNode): number | null {
  const fromMetafield = Number.parseFloat(node.mfWeight?.value ?? "");
  if (Number.isFinite(fromMetafield) && fromMetafield > 0) return fromMetafield;
  const grams = Number(node.totalWeight);
  return Number.isFinite(grams) && grams > 0 ? grams / 1000 : null;
}

function resolveDeliveredAt(node: ShopifyOrderNode): string | null {
  const stamps = node.fulfillments
    .map((f) => f.deliveredAt)
    .filter((d): d is string => Boolean(d) && !Number.isNaN(Date.parse(d as string)));
  if (stamps.length > 0) {
    return new Date(Math.min(...stamps.map((s) => Date.parse(s)))).toISOString();
  }
  const fromMetafield = node.mfDelivered?.value;
  if (fromMetafield && !Number.isNaN(Date.parse(fromMetafield))) {
    return new Date(fromMetafield).toISOString();
  }
  return null;
}

/** Map one Shopify order node to our Order. Throws OrderDataError when the claim data is missing. */
export function mapShopifyOrder(node: ShopifyOrderNode): Order {
  const carrier = resolveCarrier(node);
  if (!carrier) {
    throw new OrderDataError(
      `Order ${node.name} has no carrier. Set metafield ${METAFIELD_NAMESPACE}.carrier or tag ${CARRIER_TAG_PREFIX}<colissimo|mondial_relay|chronopost|dhl_paket|gls>.`,
    );
  }
  const weightKg = resolveWeightKg(node);
  if (weightKg === null) {
    throw new OrderDataError(
      `Order ${node.name} has no weight. Set metafield ${METAFIELD_NAMESPACE}.parcel_weight_kg or give the line items a weight.`,
    );
  }

  const tracking =
    node.fulfillments.flatMap((f) => f.trackingInfo).find((t) => t.number)?.number ??
    node.mfTracking?.value ??
    "";
  const service =
    node.mfService?.value?.trim() ||
    node.shippingLines.nodes.find((l) => l.title)?.title ||
    carrier;

  const lineItems: OrderLineItem[] = node.lineItems.nodes.map((li) => ({
    sku: li.sku ?? "",
    title: li.title,
    quantity: li.quantity,
    unitPrice: Number.parseFloat(li.originalUnitPriceSet.shopMoney.amount),
  }));

  return {
    id: node.name,
    name: node.shippingAddress?.name ?? "",
    email: node.email ?? "",
    createdAt: new Date(node.createdAt).toISOString(),
    deliveredAt: resolveDeliveredAt(node),
    carrier,
    service,
    trackingNumber: tracking,
    weightKg,
    currency: node.totalPriceSet.shopMoney.currencyCode || node.currencyCode,
    lineItems,
    total: Number.parseFloat(node.totalPriceSet.shopMoney.amount),
    shippingAddress: {
      city: node.shippingAddress?.city ?? "",
      country: node.shippingAddress?.country ?? "",
    },
  };
}

/**
 * Find an order by number AND e-mail in the Shopify store. Both must match: the search is
 * only a pre-filter, the exact comparison is done here on the returned nodes (Shopify's
 * search is fuzzy on some fields). Returns null for malformed input or no match.
 */
export async function fetchOrderFromShopify(
  orderNumber: string,
  email: string,
  config: ShopifyConfig,
  fetchImpl: FetchLike = fetch,
): Promise<Order | null> {
  const name = normalizeOrderNumber(orderNumber);
  const mail = normalizeEmail(email);
  if (!name || !mail) return null;

  const data = await shopifyGraphQL<{ orders: { nodes: ShopifyOrderNode[] } }>(
    config,
    ORDER_LOOKUP_QUERY,
    { query: `name:${name} email:${mail}` },
    fetchImpl,
  );

  const node = data.orders.nodes.find(
    (n) => n.name.toUpperCase() === name && emailsMatch(n.email, mail),
  );
  return node ? mapShopifyOrder(node) : null;
}
