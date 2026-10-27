import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Pinned to next@16.4.0 (the newest release older than 14 days when the repo was created).
  // `npm audit` flags three advisories on 16.0.0 - 16.4.0, all fixed by 16.4.1:
  //  - SVG image optimization (GHSA-2464-fhr4-w9xw): optimization is switched off here.
  //  - Server Actions (GHSA-p3m5-59mp-jv5r): we use plain route handlers only. NOT verified:
  //    the Next-Action header may be accepted by any App Router page.
  //  - `use cache` (GHSA-673q-mjm6-r5xr): `cacheComponents` is intentionally NOT enabled.
  // These mitigations are assumptions, so DO NOT put this version on a public URL. 16.4.1 was
  // published 2026-10-14 17:43 UTC and passes the 14-day rule on 2026-10-28 17:44 UTC (16.4.2
  // on 2026-10-29 20:57 UTC): then bump `next` and `eslint-config-next` together, exact
  // versions, and re-run audit, tests and build (`npm view next time --json` to check).
  images: { unoptimized: true },
  // The tracer follows every fs call: without these two lines a deploy made from a working
  // copy shipped all the PDFs and cases generated during development (data/runtime) and the
  // demo photos only by accident. The photos are listed on purpose (the demo-photo route
  // reads them by a computed name); the runtime folder is never part of a deployment.
  outputFileTracingIncludes: { "/api/demo-photo": ["./data/photos/**/*"] },
  outputFileTracingExcludes: { "/*": ["./data/runtime/**/*", "./tsconfig.tsbuildinfo"] },
  turbopack: {
    // A stray package-lock.json in a parent directory made Next guess the wrong root.
    root: fileURLToPath(new URL(".", import.meta.url)),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
