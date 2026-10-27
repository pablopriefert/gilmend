import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase } from "@/components/fixtures";
import type { AgentEvent, AgentEventSink, StreamEvent } from "@/lib/agent/events";
import type { CaseRecord, DamageReport } from "@/lib/types";
import { resetRateLimits } from "../_lib/rate-limit";

// POST /api/reports as an NDJSON stream (27 Oct 2026): the same run, the same storage, the same
// gates as the JSON answer, with the agent's progress sent line by line while it works.

type RunOpts = { engine: string; caseId?: string; onEvent?: AgentEventSink };
const runAgent = vi.fn<(report: DamageReport, opts: RunOpts) => Promise<CaseRecord>>();
const saveCase = vi.fn<(c: CaseRecord) => Promise<CaseRecord>>();
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: (r: DamageReport, o: RunOpts) => runAgent(r, o) }));
vi.mock("@/lib/store/cases", () => ({ saveCase: (c: CaseRecord) => saveCase(c) }));

import { POST } from "./route";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function request(over: { fields?: Record<string, string>; headers?: Record<string, string>; url?: string } = {}): Request {
  const form = new FormData();
  const fields = {
    orderNumber: "#1001",
    email: "camille.laurent@example.com",
    message: "Hi, my vase arrived broken this morning.",
    ...over.fields,
  };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.append("photos", new File([new Uint8Array(PNG)], "photo.png", { type: "image/png" }));
  return new Request(over.url ?? "http://localhost/api/reports", { method: "POST", body: form, headers: over.headers });
}

const NDJSON = { accept: "application/x-ndjson" };

async function lines(res: Response): Promise<StreamEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as StreamEvent);
}

const event = <T extends AgentEvent["type"]>(type: T, extra: object = {}): AgentEvent =>
  ({ type, t: 5, ...extra }) as unknown as AgentEvent;

let runtimeRoot: string;

beforeEach(async () => {
  runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "dd-stream-"));
  vi.stubEnv("DAMAGE_DESK_RUNTIME_DIR", runtimeRoot);
  for (const k of ["MODEL_API_KEY", "OPEN_WEIGHTS_BASE_URL", "OPEN_WEIGHTS_MODEL", "OPEN_WEIGHTS_PROVIDER", "BASETEN_API_KEY", "OPENROUTER_API_KEY"]) {
    vi.stubEnv(k, "");
  }
  resetRateLimits();
  runAgent.mockReset();
  saveCase.mockReset();
  runAgent.mockImplementation(async (report, { engine, caseId, onEvent }) => {
    onEvent?.(event("run_started", { engine, model: "fake", label: "Fake", mock: engine === "demo-mock", photos: 1, photosSent: 1 }));
    onEvent?.(event("tool_start", { tool: "get_order", turn: 1, calledBy: "model" }));
    onEvent?.(event("tool_end", { tool: "get_order", turn: 1, calledBy: "model", ok: true, ms: 12, result: null }));
    return makeCase({ id: caseId, report, engine: engine as CaseRecord["engine"] });
  });
  saveCase.mockImplementation(async (c) => c);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(runtimeRoot, { recursive: true, force: true });
});

describe("POST /api/reports as NDJSON", () => {
  it("streams accepted, then the agent's events as they happen, then done with the case id", async () => {
    const res = await POST(request({ headers: NDJSON }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/x-ndjson/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);

    const events = await lines(res);
    expect(events.map((e) => e.type)).toEqual(["accepted", "run_started", "tool_start", "tool_end", "done"]);
    const [accepted, , , , done] = events as [
      Extract<StreamEvent, { type: "accepted" }>,
      ...StreamEvent[],
      Extract<StreamEvent, { type: "done" }>,
    ];
    expect(accepted.caseId).toBe(runAgent.mock.calls[0][1].caseId);
    expect(accepted).toMatchObject({ engine: "demo-mock", requestedEngine: "muse-spark-1.3", fellBack: true, fellBackReason: "no_credentials" });
    expect(done).toMatchObject({ caseId: accepted.caseId, status: "needs_review", engine: "demo-mock" });
    expect(typeof done.t).toBe("number");
  });

  it("is also asked for with ?stream=1", async () => {
    const res = await POST(request({ url: "http://localhost/api/reports?stream=1" }));
    expect(res.headers.get("content-type")).toMatch(/^application\/x-ndjson/);
    expect((await lines(res)).at(-1)?.type).toBe("done");
  });

  it("saves the case exactly as the JSON answer does, and before it says done", async () => {
    const order: string[] = [];
    saveCase.mockImplementation(async (c) => {
      order.push(`save:${c.status}`);
      return c;
    });
    const res = await POST(request({ headers: NDJSON }));
    // Nothing is sent after `done`, and the final save has happened by then.
    const events = await lines(res);
    expect(events.at(-1)?.type).toBe("done");
    expect(order).toEqual(["save:new", "save:needs_review"]);
    expect(saveCase.mock.calls[0][0].id).toBe(runAgent.mock.calls[0][1].caseId);
  });

  it("keeps the JSON answer as the default: same status, body and no onEvent given to the agent", async () => {
    const res = await POST(request());
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toMatchObject({ caseId: expect.stringMatching(/^case_/), status: "needs_review", engine: "demo-mock", fellBack: true });
    expect(runAgent.mock.calls[0][1].onEvent).toBeUndefined();

    // A browser's usual Accept header does not switch it on.
    const withBrowserAccept = await POST(request({ headers: { accept: "application/json, text/plain, */*" } }));
    expect(withBrowserAccept.status).toBe(201);
  });

  it("says the engine really used, and the daily ceiling, in the first line", async () => {
    vi.stubEnv("MODEL_API_KEY", "fake-key-for-test");
    vi.stubEnv("DAMAGE_DESK_REAL_RUNS_PER_DAY", "1");
    const first = await lines(await POST(request({ headers: NDJSON })));
    expect(first[0]).toMatchObject({ type: "accepted", engine: "muse-spark-1.3", fellBack: false, fellBackReason: null });
    const second = await lines(await POST(request({ headers: NDJSON })));
    expect(second[0]).toMatchObject({ type: "accepted", engine: "demo-mock", fellBack: true, fellBackReason: "daily_limit" });
    expect(second.at(-1)).toMatchObject({ type: "done", engine: "demo-mock" });
  });

  it("ends with an error event that carries the stored case when the agent throws", async () => {
    runAgent.mockRejectedValue(new Error("secret internal detail: key=abc"));
    const events = await lines(await POST(request({ headers: NDJSON })));
    const last = events.at(-1) as Extract<StreamEvent, { type: "error" }>;
    expect(last).toMatchObject({ type: "error", code: "agent_failed", caseId: expect.stringMatching(/^case_/) });
    expect(JSON.stringify(events)).not.toMatch(/secret internal detail/);
    // The same fallback as before: the report stays as a "new" case with the failure on its trace.
    const saved = saveCase.mock.calls.at(-1)![0];
    expect(saved).toMatchObject({ id: last.caseId, status: "new", decision: null });
    expect(saved.trace.at(-1)?.step).toMatch(/agent run failed/);
  });

  it("ends with an error event when the finished case cannot be saved", async () => {
    saveCase.mockResolvedValueOnce(makeCase()).mockRejectedValue(new Error("disk full"));
    const events = await lines(await POST(request({ headers: NDJSON })));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "storage_failed", caseId: expect.stringMatching(/^case_/) });
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("does not stream when the report is refused before the run: plain JSON, same codes", async () => {
    const invalid = await POST(request({ fields: { orderNumber: "", email: "nope", message: "" }, headers: NDJSON }));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("content-type")).toMatch(/application\/json/);
    expect((await invalid.json()).error).toBe("validation");

    saveCase.mockRejectedValue(new Error("disk full"));
    const down = await POST(request({ headers: NDJSON }));
    expect(down.status).toBe(500);
    expect((await down.json()).error).toBe("storage_failed");
    expect(runAgent).not.toHaveBeenCalled();
  });
});

describe("POST /api/reports as NDJSON: the gates are unchanged", () => {
  const CODE = "judges-2026-k7Qm";

  it("refuses a report without the access code, with a plain 401, and runs nothing", async () => {
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", CODE);
    for (const headers of [NDJSON, { ...NDJSON, "x-access-code": "nope" }]) {
      const res = await POST(request({ headers }));
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect((await res.json()).error).toBe("access_code_required");
    }
    expect(runAgent).not.toHaveBeenCalled();
    expect(saveCase).not.toHaveBeenCalled();
    expect(existsSync(path.join(runtimeRoot, "uploads"))).toBe(false);
  });

  it("streams for the right code", async () => {
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", CODE);
    const res = await POST(request({ headers: { ...NDJSON, "x-access-code": CODE } }));
    expect(res.status).toBe(200);
    expect((await lines(res)).at(-1)?.type).toBe("done");
  });

  it("rate limits a client that floods the route, with a plain 429", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 31; i++) last = await POST(request({ headers: { ...NDJSON, "x-forwarded-for": "203.0.113.9" } }));
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(last?.headers.get("content-type")).toMatch(/application\/json/);
  });
});

describe("POST /api/reports as NDJSON: the client leaves", () => {
  it("lets the run finish and saves the case when the reader goes away mid-run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    runAgent.mockImplementation(async (report, { engine, caseId, onEvent }) => {
      onEvent?.(event("run_started", { engine, model: "fake", label: "Fake", mock: false, photos: 1, photosSent: 1 }));
      await gate;
      // The listener is still called after the browser left: it must not throw into the agent.
      onEvent?.(event("tool_start", { tool: "get_order", turn: 1, calledBy: "model" }));
      return makeCase({ id: caseId, report, engine: engine as CaseRecord["engine"] });
    });

    const res = await POST(request({ headers: NDJSON }));
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"type":"accepted"');
    await reader.cancel(); // the tab is closed

    release();
    await vi.waitFor(() => expect(saveCase).toHaveBeenCalledTimes(2));
    const final = saveCase.mock.calls[1][0];
    expect(final.status).toBe("needs_review");
    expect(final.id).toBe(saveCase.mock.calls[0][0].id);
  });
});
