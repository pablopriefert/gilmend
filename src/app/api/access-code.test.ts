import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase } from "@/components/fixtures";
import type { CaseRecord, DamageReport } from "@/lib/types";
import { encodeWav } from "@/lib/voice/wav";
import { ACCESS_FAILURES, requireAccessCode } from "./_lib/access";
import { resetRateLimits } from "./_lib/rate-limit";

// The failed-attempt limit is shared by every route that takes the access code: a guess is a
// guess whichever door it is tried at. These tests run the real routes (agent, store and speech
// API mocked) to prove the count is shared and per client.

const getCase = vi.fn();
const updateCase = vi.fn();
const saveCase = vi.fn<(c: CaseRecord) => Promise<CaseRecord>>();
const runAgent = vi.fn<(report: DamageReport, opts: { engine: string; caseId?: string }) => Promise<CaseRecord>>();
vi.mock("@/lib/store/cases", () => ({
  getCase: (id: string) => getCase(id),
  updateCase: (id: string, p: unknown, o: unknown) => updateCase(id, p, o),
  saveCase: (c: CaseRecord) => saveCase(c),
}));
vi.mock("@/lib/agent/run-agent", () => ({
  runAgent: (r: DamageReport, o: { engine: string; caseId?: string }) => runAgent(r, o),
}));
vi.mock("@/lib/voice/transcribe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/transcribe")>();
  return { ...actual, transcribeAudio: vi.fn() };
});

import { PATCH } from "./cases/[id]/route";
import { POST as postReport } from "./reports/route";
import { POST as postTranscribe } from "./transcribe/route";

const CODE = "judges-2026-k7QmZx9p";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function headers(ip: string, code?: string): Record<string, string> {
  return { "x-forwarded-for": ip, ...(code === undefined ? {} : { "x-access-code": code }) };
}

const report = (ip: string, code?: string) => {
  const form = new FormData();
  form.set("orderNumber", "#1001");
  form.set("email", "camille.laurent@example.com");
  form.set("message", "My vase arrived broken this morning.");
  form.append("photos", new File([new Uint8Array(PNG)], "photo.png", { type: "image/png" }));
  return postReport(new Request("http://localhost/api/reports", { method: "POST", body: form, headers: headers(ip, code) }));
};

const transcribe = (ip: string, code?: string) => {
  const form = new FormData();
  form.append("audio", new File([new Uint8Array(encodeWav(new Int16Array(16_000).fill(500), 16_000))], "v.wav", { type: "audio/wav" }));
  return postTranscribe(new Request("http://localhost/api/transcribe", { method: "POST", body: form, headers: headers(ip, code) }));
};

const patch = (ip: string, code?: string) =>
  PATCH(
    new Request("http://localhost/api/cases/case-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...headers(ip, code) },
      body: JSON.stringify({ status: "approved" }),
    }),
    { params: Promise.resolve({ id: "case-1" }) },
  );

beforeEach(() => {
  vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", CODE);
  vi.stubEnv("MODEL_API_KEY", "");
  resetRateLimits();
  getCase.mockResolvedValue(makeCase());
  updateCase.mockImplementation(async (_id: string, p: Partial<CaseRecord>) => ({ ...makeCase(), ...p }));
  saveCase.mockImplementation(async (c) => c);
  runAgent.mockImplementation(async (r, { engine, caseId }) =>
    makeCase({ id: caseId ?? "case-42", report: r, engine: engine as CaseRecord["engine"] }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  getCase.mockReset();
  updateCase.mockReset();
  saveCase.mockReset();
  runAgent.mockReset();
});

describe("failed access-code attempts", () => {
  it("allows ACCESS_FAILURES wrong codes (401), then answers 429 with Retry-After", async () => {
    expect(ACCESS_FAILURES).toEqual({ limit: 10, windowMs: 600_000 });
    for (let i = 0; i < ACCESS_FAILURES.limit; i++) {
      expect((await report("1.1.1.1", `guess-${i}`)).status, `attempt ${i + 1}`).toBe(401);
    }
    const locked = await report("1.1.1.1", "guess-11");
    expect(locked.status).toBe(429);
    expect((await locked.json()).error).toBe("too_many_attempts");
    const wait = Number(locked.headers.get("Retry-After"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(600);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("locks the right code out too, so a loop cannot keep guessing through the answer", async () => {
    for (let i = 0; i < ACCESS_FAILURES.limit; i++) await report("1.1.1.1", `guess-${i}`);
    const right = await report("1.1.1.1", CODE);
    expect(right.status).toBe(429);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("counts the same client across reports, dictation and case changes", async () => {
    for (let i = 0; i < 4; i++) await report("2.2.2.2", `a-${i}`);
    for (let i = 0; i < 3; i++) await transcribe("2.2.2.2", `b-${i}`);
    for (let i = 0; i < 3; i++) await patch("2.2.2.2", `c-${i}`);
    // Ten failures in total, on three different doors: all three are now shut.
    expect((await report("2.2.2.2", "x")).status).toBe(429);
    expect((await transcribe("2.2.2.2", "x")).status).toBe(429);
    expect((await patch("2.2.2.2", "x")).status).toBe(429);
    expect(updateCase).not.toHaveBeenCalled();
  });

  it("is per client: another address is not locked", async () => {
    for (let i = 0; i < ACCESS_FAILURES.limit; i++) await report("3.3.3.3", `guess-${i}`);
    expect((await report("3.3.3.3", "again")).status).toBe(429);
    expect((await report("4.4.4.4", CODE)).status).toBe(201);
  });

  it("does not count a request without any code, nor a right code", async () => {
    for (let i = 0; i < 25; i++) {
      // 25 anonymous requests answer 401 each time and use up none of the allowance. (The reports
      // route has its own limit of 30 requests per 10 minutes, not reached here.)
      const res = await patch("5.5.5.5");
      expect(res.status).toBe(401);
    }
    expect((await patch("5.5.5.5", CODE)).status).toBe(200);
    for (let i = 0; i < ACCESS_FAILURES.limit - 1; i++) await patch("5.5.5.5", `guess-${i}`);
    expect((await patch("5.5.5.5", CODE)).status).toBe(200);
  });

  it("lets a locked-out client without a code keep getting the plain 401, not a hint", async () => {
    for (let i = 0; i < ACCESS_FAILURES.limit; i++) await patch("6.6.6.6", `guess-${i}`);
    expect((await patch("6.6.6.6", "one-more")).status).toBe(429);
    expect((await patch("6.6.6.6")).status).toBe(401);
  });

  it("forgets the failures once the window has slid", () => {
    const t0 = Date.parse("2026-11-02T12:00:00Z");
    const req = (code: string) =>
      new Request("http://x", { headers: { "x-forwarded-for": "7.7.7.7", "x-access-code": code } });
    const env = { DAMAGE_DESK_ACCESS_CODE: CODE };
    for (let i = 0; i < ACCESS_FAILURES.limit; i++) expect(requireAccessCode(req(`g${i}`), "m", env, t0)?.status).toBe(401);
    expect(requireAccessCode(req(CODE), "m", env, t0 + 1000)?.status).toBe(429);
    expect(requireAccessCode(req(CODE), "m", env, t0 + ACCESS_FAILURES.windowMs + 1000)).toBeNull();
  });

  it("checks nothing when no code is configured", () => {
    const req = new Request("http://x", { headers: { "x-access-code": "whatever" } });
    expect(requireAccessCode(req, "m", {})).toBeNull();
    expect(requireAccessCode(req, "m", { DAMAGE_DESK_ACCESS_CODE: "  " })).toBeNull();
  });
});
