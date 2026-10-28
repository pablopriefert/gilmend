import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as cronRoute from "../src/app/api/sweep/cron/route";

// What the daily sweep needs from the repository, kept next to each other so the schedule, the
// route it calls and the way the route protects itself cannot drift apart without a test saying so.

const ROOT = path.resolve(__dirname, "..");
const config = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
  crons?: { path: string; schedule: string }[];
};

describe("vercel.json", () => {
  it("schedules the sweep once a day at 06:00 UTC (07:00 in Paris in winter)", () => {
    expect(config.crons).toEqual([{ path: "/api/sweep/cron", schedule: "0 6 * * *" }]);
  });

  it("points at a route that exists and answers GET, which is what Vercel Cron sends", () => {
    const [{ path: route }] = config.crons!;
    expect(existsSync(path.join(ROOT, "src/app", route, "route.ts"))).toBe(true);
    expect(typeof cronRoute.GET).toBe("function");
    expect("POST" in cronRoute).toBe(false);
  });

  it("holds no secret: the bearer is CRON_SECRET, set in the project's environment", () => {
    expect(readFileSync(path.join(ROOT, "vercel.json"), "utf8")).not.toMatch(/secret|bearer|token/i);
  });

  it("tells the person who deploys that CRON_SECRET must be set, and that the route refuses without it", () => {
    const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");
    expect(example).toMatch(/^CRON_SECRET=$/m);
    expect(example).toMatch(/REFUSES EVERY CALL/);
  });

  it("gives the cron route room for six short model calls", () => {
    expect(cronRoute.maxDuration).toBeGreaterThanOrEqual(30);
    expect(cronRoute.maxDuration).toBeLessThanOrEqual(300);
  });
});
