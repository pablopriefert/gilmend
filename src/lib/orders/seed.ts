import type { Order } from "../types";
import {
  CARRIER_TAG_PREFIX,
  METAFIELD_NAMESPACE,
  shopifyGraphQL,
  type ShopifyConfig,
} from "./shopify";

// Logic of scripts/seed-shopify-dev-store.ts, kept here so it is unit-tested with a mocked
// fetch. It WRITES to a Shopify store, which the rest of the app never does: it needs a
// separate, temporary token with write_draft_orders + write_orders (+ read_orders), and it
// refuses to run on anything that is not a partner development store.

export const FIXTURE_TAG = "damage-desk-fixture";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface MoneyInput {
  amount: string;
  currencyCode: string;
}

const money = (amount: number, currencyCode: string): MoneyInput => ({
  amount: amount.toFixed(2),
  currencyCode,
});

/** Tag used to find (and skip) an already seeded fixture: "#1001" -> "dd-fixture-1001". */
export const fixtureTag = (orderId: string) => `dd-fixture-${orderId.replace(/^#/, "")}`;

/** Metafields the app reads back (see the DATA CONVENTION in shopify.ts). */
export function buildOrderMetafields(order: Order) {
  const fields: { key: string; type: string; value: string }[] = [
    { key: "carrier", type: "single_line_text_field", value: order.carrier },
    { key: "service", type: "single_line_text_field", value: order.service },
    { key: "tracking_number", type: "single_line_text_field", value: order.trackingNumber },
    { key: "parcel_weight_kg", type: "number_decimal", value: String(order.weightKg) },
  ];
  if (order.deliveredAt) {
    // Whole seconds: the date_time metafield type does not need (or promise) milliseconds.
    const value = order.deliveredAt.replace(/\.\d{3}Z$/, "Z");
    fields.push({ key: "delivered_at", type: "date_time", value });
  }
  return fields.map((f) => ({ namespace: METAFIELD_NAMESPACE, ...f }));
}

function splitName(full: string): { firstName: string; lastName: string } {
  const [firstName, ...rest] = full.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") || "-" };
}

/** DraftOrderInput for one fixture order (custom line items: no product catalogue needed). */
export function buildDraftOrderInput(order: Order, shippingEur: number) {
  const { firstName, lastName } = splitName(order.name);
  return {
    email: order.email,
    note: "Fictitious order created by scripts/seed-shopify-dev-store.ts for the Gilmend demo. Not a real customer.",
    tags: [FIXTURE_TAG, fixtureTag(order.id), `${CARRIER_TAG_PREFIX}${order.carrier}`],
    lineItems: order.lineItems.map((li) => ({
      title: li.title,
      sku: li.sku,
      quantity: li.quantity,
      originalUnitPriceWithCurrency: money(li.unitPrice, order.currency),
      requiresShipping: true,
      taxable: false,
    })),
    shippingLine: { title: order.service, priceWithCurrency: money(shippingEur, order.currency) },
    // Invented address: only the city/country carry meaning for the demo.
    shippingAddress: {
      firstName,
      lastName,
      address1: "1 rue de l'Exemple",
      city: order.shippingAddress.city,
      zip: "75001",
      countryCode: "FR",
    },
  };
}

const SHOP_QUERY = /* GraphQL */ `
  query SeedShop {
    shop { name myshopifyDomain plan { partnerDevelopment } }
  }
`;
const FIND_QUERY = /* GraphQL */ `
  query SeedFind($query: String!) {
    orders(first: 1, query: $query) { nodes { name } }
  }
`;
const DRAFT_CREATE = /* GraphQL */ `
  mutation SeedDraftCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id }
      userErrors { field message }
    }
  }
`;
const DRAFT_COMPLETE = /* GraphQL */ `
  mutation SeedDraftComplete($id: ID!) {
    draftOrderComplete(id: $id, paymentPending: false) {
      draftOrder { order { id name } }
      userErrors { field message }
    }
  }
`;
const METAFIELDS_SET = /* GraphQL */ `
  mutation SeedMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

interface UserError {
  field?: string[] | null;
  message: string;
}

function assertNoUserErrors(step: string, errors: UserError[] | undefined) {
  if (errors && errors.length > 0) {
    throw new Error(`${step} failed: ${errors.map((e) => e.message).join("; ")}`);
  }
}

export interface SeedOptions {
  /** Orders to create (already resolved against "now": delivery dates are absolute in Shopify). */
  orders: Order[];
  /** Shipping fee per order id (the Order type has no shipping field). */
  shippingEurById: Record<string, number>;
  /** null in dry-run mode. */
  config: ShopifyConfig | null;
  /** false = print what would be created and call nothing. */
  execute: boolean;
  fetchImpl?: FetchLike;
  log?: (line: string) => void;
  /** Pause between API calls, in ms (rate limits). */
  pauseMs?: number;
}

export interface SeedResult {
  created: { fixtureId: string; shopifyName: string }[];
  skipped: string[];
  /** Fixture ids whose Shopify order name differs from the fixture id (customers quote the Shopify name). */
  renamed: { fixtureId: string; shopifyName: string }[];
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export async function runSeed(opts: SeedOptions): Promise<SeedResult> {
  const log = opts.log ?? (() => {});
  const result: SeedResult = { created: [], skipped: [], renamed: [] };

  if (!opts.execute) {
    for (const order of opts.orders) {
      const input = buildDraftOrderInput(order, opts.shippingEurById[order.id] ?? 0);
      log(`[dry-run] would create ${order.id} (${order.carrier}, ${order.lineItems.length} line item(s))`);
      log(JSON.stringify(input));
    }
    log("[dry-run] nothing was sent. Re-run with --execute to create these orders.");
    return result;
  }

  const config = opts.config;
  if (!config) throw new Error("--execute needs SHOPIFY_STORE_DOMAIN and SHOPIFY_SEED_TOKEN");
  const call = <T>(query: string, variables: Record<string, unknown>) =>
    shopifyGraphQL<T>(config, query, variables, opts.fetchImpl);

  // Safety net: never write fictitious orders into a real shop.
  const { shop } = await call<{
    shop: { name: string; myshopifyDomain: string; plan: { partnerDevelopment: boolean } };
  }>(SHOP_QUERY, {});
  if (!shop.plan.partnerDevelopment) {
    throw new Error(
      `Refusing to seed "${shop.myshopifyDomain}": it is not a partner development store.`,
    );
  }
  log(`Seeding development store ${shop.myshopifyDomain}`);

  for (const order of opts.orders) {
    const existing = await call<{ orders: { nodes: { name: string }[] } }>(FIND_QUERY, {
      query: `tag:${fixtureTag(order.id)}`,
    });
    if (existing.orders.nodes.length > 0) {
      log(`skip ${order.id}: already seeded as ${existing.orders.nodes[0].name}`);
      result.skipped.push(order.id);
      continue;
    }

    const draft = await call<{
      draftOrderCreate: { draftOrder: { id: string } | null; userErrors: UserError[] };
    }>(DRAFT_CREATE, { input: buildDraftOrderInput(order, opts.shippingEurById[order.id] ?? 0) });
    assertNoUserErrors(`draftOrderCreate ${order.id}`, draft.draftOrderCreate.userErrors);
    const draftId = draft.draftOrderCreate.draftOrder?.id;
    if (!draftId) throw new Error(`draftOrderCreate ${order.id} returned no draft order`);

    const done = await call<{
      draftOrderComplete: {
        draftOrder: { order: { id: string; name: string } | null } | null;
        userErrors: UserError[];
      };
    }>(DRAFT_COMPLETE, { id: draftId });
    assertNoUserErrors(`draftOrderComplete ${order.id}`, done.draftOrderComplete.userErrors);
    const created = done.draftOrderComplete.draftOrder?.order;
    if (!created) throw new Error(`draftOrderComplete ${order.id} returned no order`);

    // Metafields are set on the completed order rather than the draft: it does not depend
    // on Shopify copying draft metafields over.
    const mf = await call<{ metafieldsSet: { userErrors: UserError[] } }>(METAFIELDS_SET, {
      metafields: buildOrderMetafields(order).map((m) => ({ ...m, ownerId: created.id })),
    });
    assertNoUserErrors(`metafieldsSet ${order.id}`, mf.metafieldsSet.userErrors);

    result.created.push({ fixtureId: order.id, shopifyName: created.name });
    if (created.name !== order.id) {
      result.renamed.push({ fixtureId: order.id, shopifyName: created.name });
      log(`created ${order.id} as ${created.name} (name differs: customers must quote ${created.name})`);
    } else {
      log(`created ${order.id}`);
    }
    await sleep(opts.pauseMs ?? 0);
  }
  return result;
}
