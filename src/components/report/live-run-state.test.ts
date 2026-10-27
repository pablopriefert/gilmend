import { describe, expect, it } from "vitest";
import type { AgentEvent, StreamEvent, ToolResult } from "@/lib/agent/events";
import {
  describeResult,
  formatOffset,
  initialLiveRun,
  loseLiveRun,
  reduceLiveRun,
  thinkingLabel,
  photosShown,
  type LiveRunState,
} from "./live-run-state";

const ORDER = {
  orderId: "#1001",
  carrier: "colissimo" as const,
  service: "Colissimo Domicile sans signature",
  items: ["Ceramic vase"],
  deliveredAt: "2026-10-25T14:00:00.000Z",
  total: 59,
  currency: "EUR",
};

const accepted = (engine: "muse-spark-1.3" | "demo-mock" = "muse-spark-1.3"): StreamEvent => ({
  type: "accepted",
  t: 0,
  caseId: "case_x",
  engine,
  requestedEngine: "muse-spark-1.3",
  fellBack: engine !== "muse-spark-1.3",
  fellBackReason: engine === "demo-mock" ? "no_credentials" : null,
});
const started = (mock = false, photos = 1, photosSent = photos): AgentEvent => ({
  type: "run_started",
  t: 3,
  engine: mock ? "demo-mock" : "muse-spark-1.3",
  model: "m",
  label: mock ? "DEMO MODE: deterministic mock, not Muse" : "Muse Spark 1.3 (Meta Model API)",
  mock,
  photos,
  photosSent,
});
const toolStart = (tool: string, t: number, calledBy: "model" | "code" = "model"): AgentEvent => ({ type: "tool_start", t, tool, turn: 1, calledBy });
const toolEnd = (tool: string, t: number, result: ToolResult | null, over: Partial<Extract<AgentEvent, { type: "tool_end" }>> = {}): AgentEvent => ({
  type: "tool_end",
  t,
  tool,
  turn: 1,
  calledBy: "model",
  ok: true,
  ms: 100,
  result,
  ...over,
});

const play = (events: StreamEvent[], from: LiveRunState = initialLiveRun()) => events.reduce(reduceLiveRun, from);

describe("reduceLiveRun", () => {
  it("starts on the one thing that is really happening: the report going up", () => {
    const s = initialLiveRun();
    expect(s.phase).toBe("sending");
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0]).toMatchObject({ label: "Sending the report", state: "running" });
  });

  it("accepted finishes the upload step and names the engine, the mock included", () => {
    const real = play([accepted()]);
    expect(real).toMatchObject({ phase: "running", engine: "muse-spark-1.3", mock: false, caseId: "case_x" });
    expect(real.steps[0]).toMatchObject({ state: "done", label: "Report received and stored" });
    expect(play([accepted("demo-mock")]).mock).toBe(true);
  });

  it("opens a row when a tool starts and fills it when it ends, with the server's own timing", () => {
    const s = play([
      accepted(),
      started(),
      toolStart("get_order", 4200),
      toolEnd("get_order", 4350, { tool: "get_order", found: true, order: ORDER }, { ms: 150 }),
    ]);
    const row = s.steps.at(-1)!;
    expect(row).toMatchObject({ tool: "get_order", state: "done", atMs: 4200, ms: 150 });
    expect(row.detail).toMatch(/Order #1001 found, shipped by Colissimo/);
    expect(s.order).toEqual(ORDER);
    expect(formatOffset(row.atMs)).toBe("+4.2 s");
  });

  it("keeps a tool that is still running as a running row", () => {
    const s = play([accepted(), toolStart("mark_damage", 9000)]);
    expect(s.steps.at(-1)).toMatchObject({ tool: "mark_damage", state: "running" });
  });

  it("matches an end to the running row of the same tool and caller, even when another tool is nested inside", () => {
    // The code's outline runs inside the drafting of the claim.
    const s = play([
      accepted(),
      toolStart("draft_claim_document", 30_000, "code"),
      toolStart("mark_damage", 30_010, "code"),
      toolEnd("mark_damage", 33_000, { tool: "mark_damage", photoIndex: 0, concepts: ["torn cardboard"], method: "sam-3.1", regions: 2, annotatedPath: "data/runtime/evidence/a.jpg", note: "n" }, { calledBy: "code", ms: 2990 }),
      toolEnd("draft_claim_document", 34_000, { tool: "draft_claim_document", ok: true }, { calledBy: "code", ms: 4000 }),
    ]);
    const states = s.steps.filter((r) => r.kind === "tool").map((r) => [r.tool, r.state]);
    expect(states).toEqual([
      ["draft_claim_document", "done"],
      ["mark_damage", "done"],
    ]);
    expect(s.outline).toMatchObject({ path: "data/runtime/evidence/a.jpg", regions: 2, atMs: 33_000 });
  });

  it("shows the outline only when an image was stored, and keeps the first one", () => {
    const none = play([toolEnd("mark_damage", 5, { tool: "mark_damage", photoIndex: 0, concepts: [], method: "none", regions: 0, annotatedPath: null, note: "Raw photo." })]);
    expect(none.outline).toBeNull();
    const mark = (path: string, t: number) =>
      toolEnd("mark_damage", t, { tool: "mark_damage", photoIndex: 0, concepts: [], method: "sam-3.1", regions: 1, annotatedPath: path, note: "n" });
    const two = play([mark("a.jpg", 1), mark("b.jpg", 2)]);
    expect(two.outline?.path).toBe("a.jpg");
  });

  it("keeps the claim the code computed, and says an order was not found", () => {
    const s = play([
      toolEnd("compute_claim", 20_000, { tool: "compute_claim", eligible: true, maxCompensationEur: 32.2, claimDeadline: "2026-11-15T23:59:59.000Z", daysLeft: 19 }),
      toolEnd("get_order", 21_000, { tool: "get_order", found: false, order: null }),
    ]);
    expect(s.claim).toEqual({ eligible: true, maxCompensationEur: 32.2, claimDeadline: "2026-11-15T23:59:59.000Z", daysLeft: 19 });
    expect(s.orderMissing).toBe(true);
    expect(s.steps.at(-1)?.detail).toBe("No order matches this number and e-mail.");
  });

  it("marks a failed tool with its reason, and adds a row for an end that had no start", () => {
    const s = play([toolStart("finish_case", 10), toolEnd("finish_case", 12, null, { ok: false, error: "decision is not valid" })]);
    expect(s.steps.at(-1)).toMatchObject({ state: "failed", detail: "decision is not valid" });
    const orphan = play([toolEnd("get_carrier_rules", 500, { tool: "get_carrier_rules", carrier: "colissimo", label: "Colissimo" }, { ms: 200 })]);
    expect(orphan.steps.at(-1)).toMatchObject({ tool: "get_carrier_rules", state: "done", atMs: 300 });
  });

  it("shows model turns with the right subject, and the scripted mock never 'reads' anything", () => {
    expect(thinkingLabel("muse-spark-1.3", 1, "running")).toBe("Muse is reading the report and the photos");
    expect(thinkingLabel("muse-spark-1.3", 3, "done")).toBe("Muse decided the next step");
    expect(thinkingLabel("demo-mock", 1, "running")).toMatch(/scripted mock starts its script \(it reads no image\)/);
    const s = play([
      accepted(),
      { type: "thinking", t: 10, turn: 1, phase: "start" },
      { type: "thinking", t: 4000, turn: 1, phase: "end", ok: true, toolCalls: 1, ms: 3990 },
    ]);
    expect(s.steps.at(-1)).toMatchObject({ kind: "thinking", state: "done", ms: 3990, label: "Muse read the report and the photos" });
    const failed = play([
      accepted(),
      { type: "thinking", t: 10, turn: 1, phase: "start" },
      { type: "thinking", t: 900, turn: 1, phase: "end", ok: false, toolCalls: 0, ms: 890 },
    ]);
    expect(failed.steps.at(-1)).toMatchObject({ state: "failed", detail: "The model call failed." });
  });

  describe("what the model is said to have read (review of 28 Oct 2026)", () => {
    const turn1 = (from: LiveRunState, endAt?: number) =>
      play(
        [
          { type: "thinking", t: 10, turn: 1, phase: "start" },
          ...(endAt ? ([{ type: "thinking", t: endAt, turn: 1, phase: "end", ok: true, toolCalls: 1, ms: endAt - 10 }] as StreamEvent[]) : []),
        ],
        from,
      );

    it("says the photos were read when every one was shown", () => {
      const s = turn1(play([accepted(), started()]), 4000);
      expect(s.steps.at(-1)?.label).toBe("Muse read the report and the photos");
    });

    it("never says the photos were read by a model that was configured without image input", () => {
      // The route sends the notice, then run_started with photosSent 0, before the first turn.
      const withheld: StreamEvent = { type: "notice", t: 2, code: "photos_withheld", message: "The photos were not read by the model." };
      const open = play([accepted(), withheld, { ...(started(false, 1, 0) as Extract<AgentEvent, { type: "run_started" }>), engine: "open-weights" }]);
      expect(open.photos).toEqual({ sent: 0, total: 1 });
      const running = turn1(open);
      expect(running.steps.at(-1)?.label).toBe("The open-weights model is reading the report (photos not shown to it)");
      const finished = turn1(open, 5000);
      expect(finished.steps.at(-1)?.label).toBe("The open-weights model read the report (photos not shown to it)");
    });

    it("rewords turn 1 when the images are refused in the middle of it (HTTP 400, then a retry without them)", () => {
      const mid = turn1(play([accepted(), started()]));
      expect(mid.steps.at(-1)?.label).toBe("Muse is reading the report and the photos");
      const refused = reduceLiveRun(mid, { type: "notice", t: 900, code: "photos_withheld", message: "The photos were not read by the model (HTTP 400)." });
      // The row that is on screen is corrected at once, and the warning row comes after it.
      const thinking = refused.steps.find((r) => r.kind === "thinking")!;
      expect(thinking).toMatchObject({ state: "running", label: "Muse is reading the report (photos not shown to it)" });
      expect(refused.steps.at(-1)).toMatchObject({ kind: "notice", warning: true });
      const ended = reduceLiveRun(refused, { type: "thinking", t: 6000, turn: 1, phase: "end", ok: true, toolCalls: 1, ms: 5990 });
      expect(ended.steps.find((r) => r.kind === "thinking")?.label).toBe("Muse read the report (photos not shown to it)");
      expect(ended.photos).toEqual({ sent: 0, total: 1 });
    });

    it("says only some of the photos were read when one could not be read", () => {
      const s = turn1(play([accepted(), started(false, 2, 1)]), 3000);
      expect(photosShown(s.photos)).toBe("some");
      expect(s.steps.at(-1)?.label).toBe("Muse read the report and some of the photos");
    });

    it("words the three cases, and leaves later turns and the mock alone", () => {
      expect(thinkingLabel("muse-spark-1.3", 1, "running", "none")).toBe("Muse is reading the report (photos not shown to it)");
      expect(thinkingLabel("muse-spark-1.3", 1, "done", "some")).toBe("Muse read the report and some of the photos");
      expect(thinkingLabel("muse-spark-1.3", 2, "done", "none")).toBe("Muse decided the next step");
      expect(thinkingLabel("demo-mock", 1, "done", "none")).toBe("The scripted mock started its script (it read no image)");
      expect(photosShown(null)).toBe("all");
      expect(photosShown({ sent: 0, total: 0 })).toBe("all");
    });
  });

  it("draws guardrails and notices as warnings", () => {
    const s = play([
      { type: "guardrail", t: 30, message: "needsHuman forced: low confidence" },
      { type: "notice", t: 31, code: "photos_withheld", message: "The photos were not read by the model." },
    ]);
    expect(s.steps.slice(-2)).toEqual([
      expect.objectContaining({ kind: "guardrail", warning: true, detail: "needsHuman forced: low confidence" }),
      expect.objectContaining({ kind: "notice", warning: true, label: "Photos not read by the model" }),
    ]);
  });

  it("finishes: the decision, then done with the case id, and nothing left spinning", () => {
    const s = play([
      accepted(),
      toolStart("draft_claim_document", 50),
      { type: "run_finished", t: 60, reachedDecision: true, decision: "reship", confidence: 0.9, needsHuman: false, carrierClaim: true, ms: 60 },
      { type: "done", t: 80, caseId: "case_x", status: "needs_review", engine: "muse-spark-1.3", requestedEngine: "muse-spark-1.3", fellBack: false, fellBackReason: null },
    ]);
    expect(s.phase).toBe("done");
    expect(s.decision).toEqual({ decision: "reship", confidence: 0.9, needsHuman: false, carrierClaim: true });
    expect(s.lastMs).toBe(80);
    expect(s.steps.some((r) => r.state === "running")).toBe(false);
  });

  it("an error event stops the spinners and keeps the case id for the link", () => {
    const s = play([accepted(), toolStart("get_order", 10), { type: "error", t: 99, code: "agent_failed", message: "The agent could not process this report.", caseId: "case_x" }]);
    expect(s).toMatchObject({ phase: "error", error: "The agent could not process this report.", caseId: "case_x" });
    expect(s.steps.some((r) => r.state === "running")).toBe(false);
  });

  it("ignores pings, and a stream that ends without done is 'lost', not 'done'", () => {
    const base = play([accepted(), toolStart("get_order", 10)]);
    expect(reduceLiveRun(base, { type: "ping", t: 9999 })).toBe(base);
    const lost = loseLiveRun(base);
    expect(lost.phase).toBe("lost");
    expect(lost.steps.some((r) => r.state === "running")).toBe(false);
    // A finished run is never turned into a lost one.
    const done = play([accepted(), { type: "error", t: 1, code: "x", message: "m" }]);
    expect(loseLiveRun(done)).toBe(done);
  });

  it("never lets the clock go backwards", () => {
    const s = play([accepted(), toolStart("get_order", 500), { type: "ping", t: 1 }, { type: "guardrail", t: 100, message: "m" }]);
    expect(s.lastMs).toBe(500);
  });
});

describe("describeResult", () => {
  it("says what was found, with amounts from the claim and the called-by-code remark", () => {
    expect(describeResult({ tool: "compute_claim", eligible: true, maxCompensationEur: 32.2, claimDeadline: null, daysLeft: 19 })).toMatch(
      /Eligible: up to €32\.20, 19 days left to claim\. Worked out by code, not by the model\./,
    );
    expect(describeResult({ tool: "compute_claim", eligible: false, maxCompensationEur: 0, claimDeadline: null, daysLeft: null })).toMatch(/Not eligible/);
    expect(describeResult({ tool: "finish_case", decision: "ask_more_photos", confidence: 0.55, needsHuman: true, carrierClaim: false })).toBe(
      "Ask for more photos, confidence 55%, needs a human.",
    );
    expect(describeResult({ tool: "assess_photos", item: "Lamp", damageType: "unclear", severity: "none", photoQuality: "blurry" })).toBe(
      "Lamp: unclear, none, photos blurry.",
    );
    const mark: ToolResult = { tool: "mark_damage", photoIndex: 0, concepts: ["broken pottery"], method: "sam-3.1", regions: 3, annotatedPath: "p.jpg", note: "n" };
    expect(describeResult(mark, "code")).toMatch(/^Called by the code, not the model\. 3 regions outlined on photo 1 for “broken pottery”\./);
    expect(describeResult({ ...mark, method: "none", regions: 0, annotatedPath: null, note: "Raw photo: DEMO MODE. SAM was not called." })).toMatch(
      /^No outline: the claim keeps the raw photo\. Raw photo: DEMO MODE\./,
    );
  });
});
