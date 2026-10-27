import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { pdfFrameHeaders, securityHeaders } from "./src/lib/security-headers";

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
  // next@16.4.1, the release that fixes the three advisories of 16.0.0 - 16.4.0 (GHSA-2464-fhr4-w9xw
  // SVG image optimization, GHSA-p3m5-59mp-jv5r Server Actions, GHSA-673q-mjm6-r5xr `use cache`).
  // Taken on 27 Oct 2026, one day before it passed the 14-day dependency rule, on purpose: the
  // public deployment could not wait, and a 13-day-old patch release from the framework's own
  // maintainers is a smaller risk than a known critical remote-code-execution bug. Image
  // optimization stays off anyway (no next/image in the app).
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
    // The follow-up route resumes a case (a recorded one included: it reads the showcase) and
    // recognises the photo of the "simulate the customer's reply" button byte for byte, to label
    // that reply as simulated: so it also needs that one file.
    "/api/cases/\\[id\\]/follow-up": ["./data/showcase/**/*", "./data/photos/lamp-sharp.webp"],
  },
  // Security headers (explained directive by directive in src/lib/security-headers.ts). The later
  // rule wins for a key both set: the claim PDF is framed by the case page, so it relaxes the two
  // framing headers (frame-ancestors 'self', SAMEORIGIN) while everything else keeps the policy.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders({ dev: process.env.NODE_ENV === "development" }) },
      { source: "/api/cases/:id/pdf", headers: pdfFrameHeaders() },
    ];
  },
  outputFileTracingExcludes: { "/*": ["./data/runtime/**/*", "./tsconfig.tsbuildinfo"] },
  turbopack: {
    // A stray package-lock.json in a parent directory made Next guess the wrong root.
    root: fileURLToPath(new URL(".", import.meta.url)),
    rules: {
      // Only the global stylesheet goes through Tailwind. A "*.css" rule also caught the Arc
      // components' CSS modules and re-typed them as plain CSS: their class names came back
      // undefined and every Arc component rendered unstyled (seen 27 Oct 2026).
      "globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
