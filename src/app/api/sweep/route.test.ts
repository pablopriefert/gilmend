import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeEngine } from "@/lib/config";
import { runtimeDir } from "@/lib/runtime-dir";
import { BRIEFING_SYSTEM } from "@/lib/sweep/text";
import { SWEEP_NOW, openCase, waitingCase } from "@/lib/sweep/plan-helpers";
import type { CaseRecord } from "@/lib/types";
import { ACCESS_FAILURES } from "../_lib/access";
import { recordHit, resetRateLimits, takeRealRun } from "../_lib/rate-limit";

const listCases = vi.fn<() => Promise<CaseRecord[]>>();
vi.mock("@/lib/store/cases", () => ({ listCases: () => listCases() }));

// A real engine that never leaves the machine: only the tests that set a key reach it.
const chat = vi.fn(async (params: { messages: { content: unknown }[] }) => ({
  choices: [
    {
      message: {
        role: "assistant",
        content: params.messages[0].content === BRIEFING_SYSTEM ? "Start with {order:1}." : "Hello,\n\nWe are still waiting for sharper photos. Thank you!",
      },
    },
  ],
}));
vi.mock("@/lib/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers")>()),
  getProvider: () => ({ engine: "muse-spark-1.3", model: "muse-spark-1.3", isMock: false, detail: describeEngine("muse-spark-1.3"), chat }),
}));

import { GET, POST } from "./route";

const CODE = "a-long-random-test-code-0123456789";
const ctxless = (init: RequestInit = {}, url = "http://localhost/api/sweep") => new Request(url, { method: "POST", ...init });
const post = (body?: unknown, headers: Record<string, string> = {}) =>
  POST(
    ctxless({
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }),
  );

beforeEach(async () => {
  resetRateLimits();
  chat.mockClear();
  listCases.mockResolvedValue([openCase("1004", { deadlineHours: 17, eur: 25 }), waitingCase("1003", 70)]);
  vi.stubEnv("MODEL_API_KEY", "");
  vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "");
  vi.stubEnv("DAMAGE_DESK_REAL_RUNS_PER_DAY", "");
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

describe("GET /api/sweep", () => {
  it("answers null before the first sweep, then the latest one", async () => {
    const empty = await GET();
    expect(empty.status).toBe(200);
    expect(empty.headers.get("Cache-Control")).toBe("no-store");
    expect(await empty.json()).toEqual({ sweep: null });
    await post();
    const { sweep } = await (await GET()).json();
    expect(sweep.items.map((i: { caseId: string }) => i.caseId)).toEqual(["1004", "1003"]);
  });
});

describe("POST /api/sweep", () => {
  it("runs a sweep locally (no access code configured) and stores it as the latest", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.stored).toBe(true);
    expect(body.sweep).toMatchObject({ version: 1, trigger: "manual", engine: "demo-mock", fellBackReason: "no_credentials", includeRecorded: false });
    expect(body.sweep.counts).toMatchObject({ due: 2, waitingOnCustomer: 1, closingSoon: 1 });
    expect((await (await GET()).json()).sweep.generatedAt).toBe(body.sweep.generatedAt);
  });

  describe("on a public deployment (access code set)", () => {
    beforeEach(() => vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", CODE));

    it("refuses a request without the code and does nothing: no case read, no sweep stored", async () => {
      const res = await post();
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("access_code_required");
      expect(listCases).not.toHaveBeenCalled();
      expect((await (await GET()).json()).sweep).toBeNull();
    });

    it("refuses a wrong code, the same way", async () => {
      const res = await post(undefined, { "x-access-code": "nope" });
      expect(res.status).toBe(401);
      expect((await res.json()).message).toMatch(/not correct/);
      expect(listCases).not.toHaveBeenCalled();
    });

    it("takes the right code", async () => {
      const res = await post({}, { "x-access-code": CODE });
      expect(res.status).toBe(200);
      expect(listCases).toHaveBeenCalledTimes(1);
    });

    it("locks a client out after ten wrong codes, even for the right one (the same counter as the other routes)", async () => {
      for (let i = 0; i < ACCESS_FAILURES.limit; i++) recordHit("access-failures:203.0.113.9", { windowMs: ACCESS_FAILURES.windowMs });
      const locked = await post(undefined, { "x-access-code": CODE, "x-forwarded-for": "203.0.113.9" });
      expect(locked.status).toBe(429);
      expect((await locked.json()).error).toBe("too_many_attempts");
      expect(locked.headers.get("Retry-After")).toBeTruthy();
      expect(listCases).not.toHaveBeenCalled();
    });
  });

  it("is rate limited per client", async () => {
    for (let i = 0; i < 6; i++) expect((await post(undefined, { "x-forwarded-for": "198.51.100.4" })).status).toBe(200);
    const limited = await post(undefined, { "x-forwarded-for": "198.51.100.4" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect((await limited.json()).error).toBe("rate_limited");
    // Another client is not affected.
    expect((await post(undefined, { "x-forwarded-for": "198.51.100.5" })).status).toBe(200);
  });

  it("reads the recorded runs only when the body says so", async () => {
    const recorded: CaseRecord = { ...openCase("rec", { deadlineHours: -20 }), recorded: { recordedOn: "2026-10-27" }, createdAt: "2026-10-27T16:00:00.000Z" };
    listCases.mockResolvedValue([recorded]);
    expect((await (await post()).json()).sweep.items).toHaveLength(0);
    const on = (await (await post({ includeRecorded: true })).json()).sweep;
    expect(on.includeRecorded).toBe(true);
    expect(on.items).toHaveLength(1);
  });

  it("answers 400 for a body that is not what it takes", async () => {
    for (const body of ["{ not json", "[]", '"x"', { includeRecorded: "yes" }]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(listCases).not.toHaveBeenCalled();
  });

  it("answers 500 without leaking the error when the cases cannot be read", async () => {
    listCases.mockRejectedValue(new Error("EACCES /secret/path"));
    const res = await post();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/);
  });

  describe("with a real engine configured", () => {
    beforeEach(() => vi.stubEnv("MODEL_API_KEY", "test-placeholder-not-a-key"));

    it("writes with the model and takes a slot of the same daily ceiling as the reports", async () => {
      vi.stubEnv("DAMAGE_DESK_REAL_RUNS_PER_DAY", "1");
      const body = await (await post()).json();
      expect(body.sweep.engine).toBe("muse-spark-1.3");
      expect(body.sweep.briefing.source).toBe("model");
      expect(chat).toHaveBeenCalledTimes(2);
      // The slot is gone: a real report would now run in DEMO MODE too.
      expect(takeRealRun(1, SWEEP_NOW.getTime())).toBe(false);
    });

    it("falls back to the labelled script when real reports already used the ceiling", async () => {
      vi.stubEnv("DAMAGE_DESK_REAL_RUNS_PER_DAY", "1");
      expect(takeRealRun(1, SWEEP_NOW.getTime())).toBe(true); // a real report
      const body = await (await post()).json();
      expect(chat).not.toHaveBeenCalled();
      expect(body.sweep).toMatchObject({ engine: "demo-mock", fellBackReason: "daily_limit" });
      expect(body.sweep.briefing.source).toBe("demo-mock");
    });
  });
});
