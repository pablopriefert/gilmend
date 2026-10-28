import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase } from "@/components/fixtures";
import type { CaseRecord, DamageReport } from "@/lib/types";
import { issueVoiceReceipt } from "@/lib/voice/token";
import { resetRateLimits } from "../_lib/rate-limit";

const runAgent = vi.fn<(report: DamageReport, opts: { engine: string; caseId?: string }) => Promise<CaseRecord>>();
const saveCase = vi.fn<(c: CaseRecord) => Promise<CaseRecord>>();
vi.mock("@/lib/agent/run-agent", () => ({
  runAgent: (r: DamageReport, o: { engine: string; caseId?: string }) => runAgent(r, o),
}));
vi.mock("@/lib/store/cases", () => ({ saveCase: (c: CaseRecord) => saveCase(c) }));

import { POST, maxDuration } from "./route";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function file(bytes: Uint8Array | Buffer, name = "photo.png", type = "image/png"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function reportRequest(
  over: { fields?: Record<string, string>; photos?: File[]; headers?: Record<string, string> } = {},
): Request {
  const form = new FormData();
  const fields = {
    orderNumber: "#1001",
    email: "camille.laurent@example.com",
    message: "Hi, my vase arrived broken this morning.",
    ...over.fields,
  };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const p of over.photos ?? [file(PNG)]) form.append("photos", p);
  return new Request("http://localhost/api/reports", { method: "POST", body: form, headers: over.headers });
}

let runtimeRoot: string;

beforeEach(async () => {
  runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "dd-reports-"));
  vi.stubEnv("DAMAGE_DESK_RUNTIME_DIR", runtimeRoot);
  vi.stubEnv("MODEL_API_KEY", "");
  vi.stubEnv("OPEN_WEIGHTS_BASE_URL", "");
  vi.stubEnv("OPEN_WEIGHTS_MODEL", "");
  vi.stubEnv("OPEN_WEIGHTS_PROVIDER", "");
  vi.stubEnv("BASETEN_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  resetRateLimits();
  runAgent.mockReset();
  saveCase.mockReset();
  runAgent.mockImplementation(async (report, { engine, caseId }) =>
    makeCase({ id: caseId ?? "case-42", report, engine: engine as CaseRecord["engine"] }),
  );
  saveCase.mockImplementation(async (c) => c);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(runtimeRoot, { recursive: true, force: true });
});

describe("POST /api/reports", () => {
  it("stores the photos, runs the agent, saves the case and returns its id", async () => {
    const res = await POST(reportRequest({ photos: [file(PNG), file(JPEG, "b.jpg", "image/jpeg")] }));
    expect(res.status).toBe(201);
    const body = await res.json();
    // The agent is told which case id to produce: the one saved as "new" before the run.
    expect(body.caseId).toMatch(/^case_/);
    expect(body.caseId).toBe(runAgent.mock.calls[0][1].caseId);

    const [report] = runAgent.mock.calls[0];
    expect(report.orderNumber).toBe("#1001");
    expect(report.customerEmail).toBe("camille.laurent@example.com");
    expect(report.photos).toHaveLength(2);
    // The extension comes from the real bytes, and the files really are on disk.
    expect(report.photos[0]).toMatch(/photo-1\.png$/);
    expect(report.photos[1]).toMatch(/photo-2\.jpg$/);
    for (const p of report.photos) expect(existsSync(path.isAbsolute(p) ? p : path.resolve(p))).toBe(true);
    expect(saveCase).toHaveBeenCalledTimes(2);
  });

  it("saves the case as 'new' BEFORE the agent runs, so a killed function leaves no orphan photos", async () => {
    const order: string[] = [];
    saveCase.mockImplementation(async (c) => {
      order.push(`save:${c.status}`);
      return c;
    });
    runAgent.mockImplementation(async (report, { engine, caseId }) => {
      order.push("agent");
      return makeCase({ id: caseId, report, engine: engine as CaseRecord["engine"] });
    });
    await POST(reportRequest());
    expect(order).toEqual(["save:new", "agent", "save:needs_review"]);
    const pending = saveCase.mock.calls[0][0];
    expect(pending.decision).toBeNull();
    expect(pending.report.photos).toHaveLength(1);
    expect(pending.id).toBe(runAgent.mock.calls[0][1].caseId);
  });

  it("declares a function duration that leaves room for a real run", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(90);
  });

  it("is honest when no key is set: the case runs on the mock and the answer says so", async () => {
    const res = await POST(reportRequest({ fields: { engine: "muse-spark-1.3" } }));
    expect(runAgent.mock.calls[0][1].engine).toBe("demo-mock");
    const body = await res.json();
    expect(body).toMatchObject({ engine: "demo-mock", requestedEngine: "muse-spark-1.3", fellBack: true });
  });

  it("runs on Muse Spark when a key is set and it was asked for", async () => {
    vi.stubEnv("MODEL_API_KEY", "fake-key-for-test");
    const res = await POST(reportRequest({ fields: { engine: "muse-spark-1.3" } }));
    expect(runAgent.mock.calls[0][1].engine).toBe("muse-spark-1.3");
    expect((await res.json()).fellBack).toBe(false);
  });

  it("runs the private engine on Baseten with only the provider switch and the Baseten key", async () => {
    vi.stubEnv("OPEN_WEIGHTS_PROVIDER", "baseten");
    vi.stubEnv("BASETEN_API_KEY", "fake-key-for-test");
    const res = await POST(reportRequest({ fields: { engine: "open-weights" } }));
    expect(runAgent.mock.calls[0][1].engine).toBe("open-weights");
    expect((await res.json()).fellBack).toBe(false);
  });

  it("falls back to labelled demo mode when the Baseten switch is set but its key is not", async () => {
    vi.stubEnv("OPEN_WEIGHTS_PROVIDER", "baseten");
    const res = await POST(reportRequest({ fields: { engine: "open-weights" } }));
    expect(runAgent.mock.calls[0][1].engine).toBe("demo-mock");
    expect(await res.json()).toMatchObject({ requestedEngine: "open-weights", fellBack: true });
  });

  it("runs the OpenRouter test engine only when it is asked for and its key is set", async () => {
    await POST(reportRequest({ fields: { engine: "openrouter" } }));
    expect(runAgent.mock.calls[0][1].engine).toBe("demo-mock");
    runAgent.mockClear();
    vi.stubEnv("OPENROUTER_API_KEY", "fake-key-for-test");
    await POST(reportRequest({ fields: { engine: "openrouter" } }));
    expect(runAgent.mock.calls[0][1].engine).toBe("openrouter");
    runAgent.mockClear();
    // An unspecified engine is never the test one, whatever keys exist.
    await POST(reportRequest({ fields: {} }));
    expect(runAgent.mock.calls[0][1].engine).toBe("demo-mock");
  });

  it("ignores an unknown engine value", async () => {
    await POST(reportRequest({ fields: { engine: "gpt-5" } }));
    expect(runAgent.mock.calls[0][1].engine).toBe("demo-mock");
  });

  it("uses the language field, else detects it from the message", async () => {
    await POST(reportRequest({ fields: { language: "fr" } }));
    expect(runAgent.mock.calls[0][0].language).toBe("fr");
    await POST(reportRequest({ fields: { language: "auto", message: "Bonjour, mon colis est arrivé cassé." } }));
    expect(runAgent.mock.calls[1][0].language).toBe("fr");
    await POST(reportRequest({ fields: { message: "My lamp is cracked, see the photos." } }));
    expect(runAgent.mock.calls[2][0].language).toBe("en");
  });

  it.each([
    ["Guten Tag, meine Karaffe ist heute kaputt angekommen, bitte um Ersatz.", "de"],
    ["Hola, mi jarrón llegó roto esta mañana, adjunto una foto.", "es"],
    ["Buongiorno, il mio vaso è arrivato rotto, allego una foto.", "it"],
  ])("detects German, Spanish and Italian from the message when the form says nothing", async (message, expected) => {
    await POST(reportRequest({ fields: { message } }));
    expect(runAgent.mock.calls[0][0].language).toBe(expected);
    await POST(reportRequest({ fields: { language: "auto", message } }));
    expect(runAgent.mock.calls[1][0].language).toBe(expected);
  });

  it("lets the language picked on the form win over what the message looks like", async () => {
    await POST(reportRequest({ fields: { language: "de", message: "My lamp is cracked, see the photos." } }));
    expect(runAgent.mock.calls[0][0].language).toBe("de");
  });

  it("rejects a report with missing fields and no photo, naming each field", async () => {
    const res = await POST(reportRequest({ fields: { orderNumber: "", email: "nope", message: "" }, photos: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation");
    expect(Object.keys(body.fields).sort()).toEqual(["email", "message", "orderNumber", "photos"]);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects more than 3 photos", async () => {
    const res = await POST(reportRequest({ photos: [file(PNG), file(PNG), file(PNG), file(PNG)] }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.photos).toMatch(/up to 3/);
  });

  it("rejects a photo over 8 MB and writes nothing", async () => {
    const big = file(Buffer.concat([Buffer.from(PNG), Buffer.alloc(8 * 1024 * 1024)]));
    const res = await POST(reportRequest({ photos: [big] }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.photos).toMatch(/8 MB/);
    expect(existsSync(path.join(runtimeRoot, "uploads"))).toBe(false);
  });

  it("rejects a file type that is not JPEG, PNG or WebP", async () => {
    const res = await POST(reportRequest({ photos: [file(Buffer.from("%PDF-1.4"), "a.pdf", "application/pdf")] }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.photos).toMatch(/not a JPEG, PNG or WebP/);
  });

  it("rejects a file whose bytes are not the image it claims to be", async () => {
    const fake = file(Buffer.from("<script>alert(1)</script>"), "evil.png", "image/png");
    const res = await POST(reportRequest({ photos: [fake] }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields.photos).toMatch(/not a real/);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects a body that is not multipart form data", async () => {
    const res = await POST(
      new Request("http://localhost/api/reports", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_form");
  });

  it("refuses an upload that declares an oversized body", async () => {
    const res = await POST(reportRequest({ headers: { "content-length": String(40 * 1024 * 1024) } }));
    expect(res.status).toBe(413);
  });

  it("keeps the report as a 'new' case with the failure on the trace when the agent throws", async () => {
    runAgent.mockRejectedValue(new Error("boom"));
    const res = await POST(reportRequest());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("agent_failed");
    expect(body.caseId).toMatch(/^case_/);
    const last = saveCase.mock.calls.at(-1)![0];
    expect(last.id).toBe(body.caseId);
    expect(last.status).toBe("new");
    expect(last.decision).toBeNull();
    expect(last.report.message).toMatch(/vase/);
    expect(last.trace.at(-1)?.step).toMatch(/agent run failed/);
  });

  it("answers 502 without leaking the error when the agent fails", async () => {
    runAgent.mockRejectedValue(new Error("secret internal detail: key=abc"));
    const res = await POST(reportRequest());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret internal detail/);
  });

  it("still answers 502 when the agent fails and the store went down in between", async () => {
    runAgent.mockRejectedValue(new Error("boom"));
    saveCase.mockResolvedValueOnce(makeCase()).mockRejectedValue(new Error("disk full"));
    const res = await POST(reportRequest());
    expect(res.status).toBe(502);
  });

  it("answers 500 and does not run the agent when the store is down from the start", async () => {
    saveCase.mockRejectedValue(new Error("disk full"));
    const res = await POST(reportRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("storage_failed");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("answers 500 when the final case cannot be saved after a successful run", async () => {
    saveCase.mockResolvedValueOnce(makeCase()).mockRejectedValue(new Error("disk full"));
    const res = await POST(reportRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("storage_failed");
  });

  it("rate limits a client that floods the route", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 31; i++) last = await POST(reportRequest({ headers: { "x-forwarded-for": "203.0.113.9" } }));
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toMatch(/^\d+$/);
    // Another client is not affected.
    const other = await POST(reportRequest({ headers: { "x-forwarded-for": "203.0.113.10" } }));
    expect(other.status).toBe(201);
  });
});

describe("POST /api/reports on a public deployment", () => {
  const CODE = "judges-2026-k7Qm";
  const withCode = (fields: Record<string, string> = {}, code: string = CODE) =>
    reportRequest({ fields, headers: { "x-access-code": code } });

  it("takes NO new report without the code, whatever the engine, demo mode included", async () => {
    vi.stubEnv("MODEL_API_KEY", "fake-key-for-test");
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", CODE);

    for (const engine of ["muse-spark-1.3", "open-weights", "openrouter", "demo-mock", ""]) {
      const res = await POST(reportRequest({ fields: engine ? { engine } : {} }));
      expect(res.status, engine).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("access_code_required");
      // The message tells the judge what to do, and what stays available without the code.
      expect(body.message).toMatch(/access code from the submission/);
      expect(body.message).toMatch(/recorded runs/);
    }
    // Nothing was stored or run: no case, no agent call, no photo on disk.
    expect(runAgent).not.toHaveBeenCalled();
    expect(saveCase).not.toHaveBeenCalled();
    expect(existsSync(path.join(runtimeRoot, "uploads"))).toBe(false);
  });

  it("refuses a wrong code the same way", async () => {
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", CODE);
    const res = await POST(withCode({}, "nope"));
    expect(res.status).toBe(401);
    expect((await res.json()).message).toMatch(/not correct/);
    expect(saveCase).not.toHaveBeenCalled();
  });

  it("runs the requested engine with the right code", async () => {
    vi.stubEnv("MODEL_API_KEY", "fake-key-for-test");
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", CODE);

    const right = await POST(withCode({ engine: "muse-spark-1.3" }));
    expect(right.status).toBe(201);
    expect(runAgent.mock.calls[0][1].engine).toBe("muse-spark-1.3");
    expect(await right.json()).toMatchObject({ engine: "muse-spark-1.3", fellBack: false, fellBackReason: null });

    // Demo mode is allowed too, for the person who has the code.
    const demo = await POST(withCode({ engine: "demo-mock" }));
    expect(demo.status).toBe(201);
    expect(runAgent.mock.calls[1][1].engine).toBe("demo-mock");
  });

  it("is open when no code is configured (local use): nothing changes", async () => {
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "");
    expect((await POST(reportRequest())).status).toBe(201);
    // A header sent for nothing is ignored, and does not count as an attempt.
    expect((await POST(reportRequest({ headers: { "x-access-code": "whatever" } }))).status).toBe(201);
  });

  it("caps real runs per day, then answers in labelled demo mode instead of failing", async () => {
    vi.stubEnv("MODEL_API_KEY", "fake-key-for-test");
    vi.stubEnv("DAMAGE_DESK_REAL_RUNS_PER_DAY", "2");
    const engines: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await POST(reportRequest({ fields: { engine: "muse-spark-1.3" } }));
      engines.push((await res.json()).engine);
    }
    expect(engines).toEqual(["muse-spark-1.3", "muse-spark-1.3", "demo-mock"]);
    const capped = await POST(reportRequest({ fields: { engine: "muse-spark-1.3" } }));
    expect(await capped.json()).toMatchObject({ fellBack: true, fellBackReason: "daily_limit" });
  });

  it("does not rate limit local development (every local request shares one bucket)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    let last: Response | undefined;
    for (let i = 0; i < 35; i++) last = await POST(reportRequest());
    expect(last?.status).toBe(201);
  });
});

describe("POST /api/reports on Vercel (read-only project folder)", () => {
  it("stores the photos under the OS temp dir, not under <cwd>/data/runtime", async () => {
    vi.stubEnv("DAMAGE_DESK_RUNTIME_DIR", "");
    vi.stubEnv("VERCEL", "1");
    const res = await POST(reportRequest());
    expect(res.status).toBe(201);
    const [report] = runAgent.mock.calls[0];
    const stored = path.resolve(report.photos[0]);
    expect(stored.startsWith(path.join(os.tmpdir(), "damage-desk", "uploads") + path.sep)).toBe(true);
    expect(stored.startsWith(path.join(process.cwd(), "data", "runtime"))).toBe(false);
    expect(existsSync(stored)).toBe(true);
    await rm(path.join(os.tmpdir(), "damage-desk", "uploads", report.id), { recursive: true, force: true });
  });
});

describe("POST /api/reports, voice note", () => {
  const KEY = "fake-key-for-test"; // secret-factice
  const SAID = "Hi, my vase arrived broken this morning.";
  /** What the form sends after a real dictation: the transcript and the receipt /api/transcribe signed. */
  const dictated = (transcript = SAID, durationMs = 5000) =>
    JSON.stringify({ clips: [{ transcript, durationMs, token: issueVoiceReceipt(transcript, durationMs, { MODEL_API_KEY: KEY }) }] });

  it("stores the voice note on the report, as a real transcription when the receipt checks out", async () => {
    vi.stubEnv("MODEL_API_KEY", KEY);
    await POST(reportRequest({ fields: { voiceNote: dictated() } }));
    expect(runAgent.mock.calls[0][0].voiceNote).toEqual({
      model: "muse-voice-transcribe-1.0",
      durationMs: 5000,
      demo: false,
      edited: false,
      partial: false,
    });
  });

  it("works out edited from the message that was sent, not from what the browser says", async () => {
    vi.stubEnv("MODEL_API_KEY", KEY);
    await POST(reportRequest({ fields: { voiceNote: dictated("May vas arrived broken, order 1001.") } }));
    expect(runAgent.mock.calls[0][0].voiceNote).toMatchObject({ demo: false, edited: true });
  });

  it("cannot claim a real transcription when the server has no key", async () => {
    await POST(reportRequest({ fields: { voiceNote: dictated() } }));
    expect(runAgent.mock.calls[0][0].voiceNote).toMatchObject({ model: "demo-mock", demo: true });
  });

  it("does not believe the old label alone: a typed message cannot pass for a Muse transcription", async () => {
    vi.stubEnv("MODEL_API_KEY", KEY);
    // A public deployment with a key and an access code, a request WITH the code: whatever the note
    // says, only a receipt issued by /api/transcribe makes it a Muse transcription, and none can be
    // invented.
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "judges-2026");
    const forged = JSON.stringify({ durationMs: 5000, demo: false });
    const noReceipt = JSON.stringify({ clips: [{ transcript: SAID, durationMs: 5000 }] });
    const fakeReceipt = JSON.stringify({ clips: [{ transcript: SAID, durationMs: 5000, token: "e30.e30" }] });
    for (const voiceNote of [forged, noReceipt, fakeReceipt]) {
      runAgent.mockClear();
      const res = await POST(reportRequest({ fields: { voiceNote }, headers: { "x-access-code": "judges-2026" } }));
      expect(res.status).toBe(201);
      const note = runAgent.mock.calls[0][0].voiceNote;
      expect(note === undefined || note.demo).toBe(true);
      expect(note?.model ?? "demo-mock").toBe("demo-mock");
    }
  });

  it("refuses a private run for a message that was really dictated with the Meta API", async () => {
    vi.stubEnv("MODEL_API_KEY", KEY);
    vi.stubEnv("OPEN_WEIGHTS_BASE_URL", "https://weights.example.test/v1");
    vi.stubEnv("OPEN_WEIGHTS_MODEL", "muse-glimmer");
    const res = await POST(reportRequest({ fields: { voiceNote: dictated(), engine: "open-weights" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("voice_not_private");
    expect(runAgent).not.toHaveBeenCalled();
    expect(saveCase).not.toHaveBeenCalled();
  });

  it("still runs privately for a typed message, and for a canned demo dictation that called nothing", async () => {
    vi.stubEnv("MODEL_API_KEY", KEY);
    vi.stubEnv("OPEN_WEIGHTS_BASE_URL", "https://weights.example.test/v1");
    vi.stubEnv("OPEN_WEIGHTS_MODEL", "muse-glimmer");
    const typed = await POST(reportRequest({ fields: { engine: "open-weights" } }));
    expect(typed.status).toBe(201);
    expect(runAgent.mock.calls[0][1].engine).toBe("open-weights");
    const canned = JSON.stringify({ clips: [{ transcript: SAID, durationMs: 5000 }] });
    const demo = await POST(reportRequest({ fields: { voiceNote: canned, engine: "open-weights" } }));
    expect(demo.status).toBe(201);
    expect(runAgent.mock.calls[1][0].voiceNote).toMatchObject({ demo: true });
  });

  it("ignores a malformed label and leaves typed messages without one", async () => {
    const bad = await POST(reportRequest({ fields: { voiceNote: "{oops" } }));
    expect(bad.status).toBe(201);
    expect(runAgent.mock.calls[0][0].voiceNote).toBeUndefined();
    await POST(reportRequest());
    expect(runAgent.mock.calls[1][0].voiceNote).toBeUndefined();
  });
});
