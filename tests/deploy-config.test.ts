import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { maxDuration } from "../src/app/api/reports/route";

// What a Vercel deployment needs from the repository, kept next to each other so one cannot
// drift from the other without a test saying so.

describe("deployment configuration", () => {
  it("traces data/showcase into every route that lists or serves a case", () => {
    const includes = nextConfig.outputFileTracingIncludes ?? {};
    // Brackets are escaped in a route glob: "/cases/\\[id\\]" is the route "/cases/[id]".
    const routes = [
      "/",
      "/cases/\\[id\\]",
      "/api/cases",
      "/api/cases/\\[id\\]",
      "/api/cases/\\[id\\]/pdf",
      "/api/files",
    ];
    for (const route of routes) expect(includes[route], route).toEqual(["./data/showcase/**/*"]);
    // The demo photos stay traced for the route that reads them by a computed name.
    expect(includes["/api/demo-photo"]).toEqual(["./data/photos/**/*"]);
  });

  it("traces the demo photos into the report route too: the photo integrity check hashes them at run time", () => {
    expect(nextConfig.outputFileTracingIncludes?.["/api/reports"]).toEqual(["./data/photos/**/*"]);
  });

  it("never ships the git-ignored runtime folder", () => {
    expect(nextConfig.outputFileTracingExcludes?.["/*"]).toContain("./data/runtime/**/*");
  });

  it("gives POST /api/reports room for a real run (about 40 s) through the route's own maxDuration, so no vercel.json is needed", () => {
    // Hobby allows up to 300 s with Fluid Compute, which is on by default (vercel.com/docs/functions/configuring-functions/duration).
    expect(maxDuration).toBeGreaterThanOrEqual(90);
    expect(maxDuration).toBeLessThanOrEqual(300);
  });
});
