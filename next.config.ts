import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

/** Routes whose server code reads data/showcase at run time (see outputFileTracingIncludes). */
const SHOWCASE_ROUTES = [
  "/",
  "/cases/\\[id\\]",
  "/api/cases",
  "/api/cases/\\[id\\]",
  "/api/cases/\\[id\\]/pdf",
  "/api/files",
];

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
  //
  // The showcase (data/showcase: six recorded real runs, their photos, evidence and PDFs) is read
  // at run time from a computed path, so the tracer cannot see it either: every route that lists
  // or serves a case lists it here (keys are route globs, brackets escaped). A route missing
  // from this list would show an empty inbox on Vercel (tests/deploy-config.test.ts keeps the
  // list and the routes that read the showcase together). Checked on the build trace of
  // next@16.4.0 with Turbopack (27 Oct 2026): the "/" key is applied to EVERY route (all eleven
  // traces hold the whole folder, about 5 MB), and without it the home page traced only the six case
  // files; the keys of the API routes and of the case page work on their own.
  outputFileTracingIncludes: {
    "/api/demo-photo": ["./data/photos/**/*"],
    ...Object.fromEntries(SHOWCASE_ROUTES.map((route) => [route, ["./data/showcase/**/*"]])),
  },
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
