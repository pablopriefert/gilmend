// Creates the fictitious fixture orders in a Shopify DEVELOPMENT store through the Admin
// GraphQL API (draftOrderCreate + draftOrderComplete, then metafieldsSet).
//
// WRITTEN, NOT RUN: it has never been executed against a store (no dev store token yet).
//
//   npx tsx scripts/seed-shopify-dev-store.ts            # dry run: prints what it would send
//   SHOPIFY_STORE_DOMAIN=my-dev-store.myshopify.com \
//   SHOPIFY_SEED_TOKEN=<token> \
//     npx tsx scripts/seed-shopify-dev-store.ts --execute [--only #1001,#1004]
//
// SHOPIFY_SEED_TOKEN is a temporary token with write_draft_orders, write_orders and
// read_orders. It is deliberately NOT SHOPIFY_ADMIN_TOKEN: the app itself only ever holds a
// read_orders token. Delivery dates are written as absolute timestamps (relative to the
// moment you run this), so run it the day before filming. Shopify names orders itself
// (#1001, #1002... on a fresh store); the script warns when a name differs from the fixture.

import { listFixtureOrders, loadFixtureOrders } from "../src/lib/orders/fixtures";
import { runSeed } from "../src/lib/orders/seed";
import { normalizeShopDomain } from "../src/lib/orders/shopify";

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const onlyArg = args.find((a) => a.startsWith("--only="))?.slice("--only=".length)
    ?? (args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined);
  const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;

  const orders = listFixtureOrders(new Date()).filter((o) => !only || only.has(o.id));
  if (orders.length === 0) throw new Error("No fixture order selected");
  const shippingEurById = Object.fromEntries(loadFixtureOrders().map((f) => [f.id, f.shippingEur]));

  let config = null;
  if (execute) {
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.SHOPIFY_SEED_TOKEN;
    if (!domain || !token) {
      throw new Error("--execute needs SHOPIFY_STORE_DOMAIN and SHOPIFY_SEED_TOKEN");
    }
    config = { shopDomain: normalizeShopDomain(domain), accessToken: token };
  }

  const result = await runSeed({
    orders,
    shippingEurById,
    config,
    execute,
    log: (line) => console.log(line),
    pauseMs: 600,
  });
  if (execute) {
    console.log(`Done: ${result.created.length} created, ${result.skipped.length} skipped.`);
    if (result.renamed.length > 0) {
      console.log("Order names that differ from data/fixtures/orders.json:");
      for (const r of result.renamed) console.log(`  ${r.fixtureId} -> ${r.shopifyName}`);
    }
  }
}

main().catch((err) => {
  // Messages never contain the token (see shopifyGraphQL).
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
