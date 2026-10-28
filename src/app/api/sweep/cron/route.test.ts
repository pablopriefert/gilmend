import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeDir } from "@/lib/runtime-dir";
import { loadLatestSweep } from "@/lib/sweep/store";
import { SWEEP_NOW, openCase, waitingCase } from "@/lib/sweep/plan-helpers";
import type { CaseRecord } from "@/lib/types";
import { resetRateLimits } from "../../_lib/rate-limit";

const listCases = vi.fn<() => Promise<CaseRecord[]>>();
vi.mock("@/lib/store/cases", () => ({ listCases: () => listCases() }));

import { GET } from "./route";

const SECRET = "a-long-random-cron-secret-for-tests-0123456789";
const call = (headers: Record<string, string> = {}) => GET(new Request("http://localhost/api/sweep/cron", { headers }));
const bearer = (value = SECRET) => ({ authorization: `Bearer ${value}` });

beforeEach(async () => {
  resetRateLimits();
  listCases.mockResolvedValue([openCase("1004", { deadlineHours: 17, eur: 25 }), waitingCase("1003", 70)]);
  vi.stubEnv("MODEL_API_KEY", "");
  vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "");
  vi.stubEnv("CRON_SECRET", SECRET);
  await fs.rm(path.join(runtimeDir(), "sweep"), { recursive: true, force: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SWEEP_NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  listCases.mockReset();
});

describe("GET /api/sweep/cron", () => {
  it("refuses every call when CRON_SECRET is not set, even one that carries a bearer", async () => {
    for (const value of ["", "   "]) {
      vi.stubEnv("CRON_SECRET", value);
      for (const headers of [{}, bearer(), bearer("")]) {
        const res = await call(headers);
        expect(res.status).toBe(503);
        expect((await res.json()).error).toBe("cron_not_configured");
      }
    }
    expect(listCases).not.toHaveBeenCalled();
    expect(await loadLatestSweep()).toBeNull();
  });

  it("answers 401 without a bearer, with a wrong one, or with another scheme, and does nothing", async () => {
    for (const headers of [{}, bearer("wrong"), { authorization: SECRET }, { authorization: `Basic ${SECRET}` }, bearer(SECRET.slice(0, -1))]) {
      const res = await call(headers);
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect((await res.json()).error).toBe("unauthorized");
    }
    expect(listCases).not.toHaveBeenCalled();
    expect(await loadLatestSweep()).toBeNull();
  });

  it("does not take the access code of the POST route", async () => {
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "the-access-code-of-the-demo");
    expect((await call({ "x-access-code": "the-access-code-of-the-demo" })).status).toBe(401);
    expect(listCases).not.toHaveBeenCalled();
  });

  it("runs the sweep with the right bearer, stores it as a scheduled run and answers a short summary", async () => {
    const res = await call(bearer());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      stored: true,
      generatedAt: SWEEP_NOW.toISOString(),
      engine: "demo-mock",
      fellBackReason: "no_credentials",
      counts: { due: 2, closingSoon: 1, waitingOnCustomer: 1 },
      modelCalls: { total: 0, cap: 6 },
    });
    // The answer is a summary: no order, item or draft in it.
    expect(JSON.stringify(body)).not.toMatch(/1004|Ceramic|Hello|Bonjour/);
    expect(await loadLatestSweep()).toMatchObject({ trigger: "cron", includeRecorded: false });
  });

  it("never reads the recorded runs", async () => {
    const recorded: CaseRecord = { ...openCase("rec", { deadlineHours: -20 }), recorded: { recordedOn: "2026-10-27" }, createdAt: "2026-10-27T16:00:00.000Z" };
    listCases.mockResolvedValue([recorded]);
    expect((await (await call(bearer())).json()).counts.cases).toBe(0);
  });

  it("locks a client out after ten wrong secrets, the right one included", async () => {
    for (let i = 0; i < 10; i++) expect((await call({ ...bearer(`wrong-${i}`), "x-forwarded-for": "203.0.113.7" })).status).toBe(401);
    const locked = await call({ ...bearer(), "x-forwarded-for": "203.0.113.7" });
    expect(locked.status).toBe(429);
    expect(locked.headers.get("Retry-After")).toBeTruthy();
    expect(listCases).not.toHaveBeenCalled();
    // Another client still gets in.
    expect((await call({ ...bearer(), "x-forwarded-for": "203.0.113.8" })).status).toBe(200);
  });

  it("answers 500 without leaking the error when the sweep fails", async () => {
    listCases.mockRejectedValue(new Error("EACCES /secret/path"));
    const res = await call(bearer());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/);
  });
});
