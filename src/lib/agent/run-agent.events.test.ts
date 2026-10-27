import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./events";
import { runAgent } from "./run-agent";
import { ASSESSMENT_BROKEN, NOW, decisionArgs, fakeDeps, makeOrder, makeReport, scriptedProvider } from "./test-helpers";

// The live events of a run (27 Oct 2026): what is emitted, in which order, and what never is.

const happyTurns = () => [
  { calls: [["get_order", { orderNumber: "#1001" }]] as [string, unknown][] },
  {
    calls: [
      ["assess_photos", ASSESSMENT_BROKEN],
      ["mark_damage", { photoIndex: 0, concept: "broken pottery" }],
      ["get_carrier_rules", { carrier: "colissimo" }],
    ] as [string, unknown][],
  },
  { calls: [["compute_claim", {}]] as [string, unknown][] },
  { calls: [["finish_case", decisionArgs()]] as [string, unknown][] },
  { calls: [["draft_claim_document", {}]] as [string, unknown][] },
];

const depsWithStoredOutline = () =>
  fakeDeps({
    markDamage: async (photo) => ({
      photo,
      annotatedPhoto: "data/runtime/evidence/abc-annotated.jpg",
      method: "sam-3.1",
      note: "SAM 3.1 outlined 2 regions matching \"broken pottery\".",
      regions: 2,
    }),
  });

async function run(over: Parameters<typeof runAgent>[1] extends infer O ? Partial<O> : never = {}) {
  const events: AgentEvent[] = [];
  const c = await runAgent(makeReport(), {
    engine: "muse-spark-1.3",
    provider: scriptedProvider(happyTurns()),
    deps: depsWithStoredOutline(),
    now: NOW,
    onEvent: (e) => events.push(e),
    ...over,
  });
  return { c, events };
}

const ends = (events: AgentEvent[]) =>
  events.filter((e): e is Extract<AgentEvent, { type: "tool_end" }> => e.type === "tool_end");

describe("runAgent events: the happy path", () => {
  it("emits the run, each model turn and each tool in the order they really happen", async () => {
    const { events } = await run();
    expect(events[0]).toMatchObject({ type: "run_started", engine: "muse-spark-1.3", model: "fake", mock: false, photos: 1 });
    // Every turn is announced before its tools, and closed once the model has answered.
    const compact = events.map((e) =>
      e.type === "thinking" ? `thinking:${e.turn}:${e.phase}` : e.type === "tool_start" || e.type === "tool_end" ? `${e.type}:${e.tool}` : e.type,
    );
    expect(compact).toEqual([
      "run_started",
      "thinking:1:start",
      "thinking:1:end",
      "tool_start:get_order",
      "tool_end:get_order",
      "thinking:2:start",
      "thinking:2:end",
      "tool_start:assess_photos",
      "tool_end:assess_photos",
      "tool_start:mark_damage",
      "tool_end:mark_damage",
      "tool_start:get_carrier_rules",
      "tool_end:get_carrier_rules",
      "thinking:3:start",
      "thinking:3:end",
      "tool_start:compute_claim",
      "tool_end:compute_claim",
      "thinking:4:start",
      "thinking:4:end",
      "tool_start:finish_case",
      "tool_end:finish_case",
      "thinking:5:start",
      "thinking:5:end",
      "tool_start:draft_claim_document",
      "tool_end:draft_claim_document",
      "run_finished",
    ]);
  });

  it("stamps every event with a clock that never goes backwards", async () => {
    const { events } = await run();
    const ts = events.map((e) => e.t);
    expect(ts.every((t) => Number.isFinite(t) && t >= 0)).toBe(true);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it("reports what each tool found, from the state the tool set", async () => {
    const { events } = await run();
    const byTool = Object.fromEntries(ends(events).map((e) => [e.tool, e]));
    expect(byTool.get_order.result).toMatchObject({
      tool: "get_order",
      found: true,
      order: { orderId: "#1001", carrier: "colissimo", items: ["Ceramic vase"] },
    });
    expect(byTool.assess_photos.result).toMatchObject({ item: "Ceramic vase", damageType: "broken_product", severity: "major" });
    expect(byTool.mark_damage.result).toMatchObject({
      tool: "mark_damage",
      regions: 2,
      annotatedPath: "data/runtime/evidence/abc-annotated.jpg",
      method: "sam-3.1",
    });
    expect((byTool.mark_damage.result as { concepts: string[] }).concepts).toContain("broken pottery");
    expect(byTool.get_carrier_rules.result).toMatchObject({ carrier: "colissimo", label: "Colissimo" });
    expect(byTool.compute_claim.result).toMatchObject({ eligible: true, maxCompensationEur: 32.2, daysLeft: 19 });
    expect(byTool.finish_case.result).toMatchObject({ decision: "reship", confidence: 0.9, needsHuman: false, carrierClaim: true });
    expect(byTool.draft_claim_document.result).toEqual({ tool: "draft_claim_document", ok: true });
    for (const e of ends(events)) expect(e).toMatchObject({ ok: true, calledBy: "model" });
  });

  it("ends with the decision and says the agent reached it", async () => {
    const { events } = await run();
    expect(events.at(-1)).toMatchObject({
      type: "run_finished",
      reachedDecision: true,
      decision: "reship",
      needsHuman: false,
      carrierClaim: true,
    });
  });

  it("reports a model turn that came back with no tool call as a closed turn with zero calls", async () => {
    const turns = [{ content: "thinking aloud" }, ...happyTurns()];
    const { events } = await run({ provider: scriptedProvider(turns) });
    const end = events.find((e) => e.type === "thinking" && e.phase === "end" && e.turn === 1);
    expect(end).toMatchObject({ ok: true, toolCalls: 0 });
  });
});

describe("runAgent events: what must never be in them", () => {
  it("carries no customer name, e-mail, address, message, reply, or photo bytes", async () => {
    const { events } = await run({
      deps: fakeDeps({
        getOrder: async () => makeOrder({ name: "Ada Lovelace", email: "ada@example.com" }),
        markDamage: async (photo) => ({
          photo,
          annotatedPhoto: "data:image/png;base64,SECRETPIXELS",
          method: "sam-3.1",
          note: "outlined",
          regions: 1,
        }),
      }),
    });
    const json = JSON.stringify(events);
    expect(json).not.toMatch(/Ada Lovelace|ada@example|Lyon|My vase arrived broken|Sorry about this|SECRETPIXELS|data:image/);
    // The annotated image is not stored here (a data URL): no path is sent, the page shows no image.
    const mark = ends(events).find((e) => e.tool === "mark_damage");
    expect(mark?.result).toMatchObject({ annotatedPath: null });
  });

  it("never echoes a key that a provider error quotes", async () => {
    const provider = scriptedProvider([{ throws: new Error("401 Incorrect API key provided: sk-abcdefghijklmnopqrstuvwxyz0123456789") }]);
    const { c, events } = await run({ provider });
    expect(c.decision?.needsHuman).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/sk-abcdef/);
    expect(events.some((e) => e.type === "notice" && e.code === "agent_incomplete")).toBe(true);
  });
});

describe("runAgent events: when things go wrong", () => {
  it("closes the failed model turn and says the agent did not reach a decision", async () => {
    const provider = scriptedProvider([{ throws: new Error("boom") }]);
    const { events } = await run({ provider });
    expect(events.find((e) => e.type === "thinking" && e.phase === "end")).toMatchObject({ ok: false, toolCalls: 0 });
    expect(events.find((e) => e.type === "notice")).toMatchObject({ code: "agent_incomplete" });
    expect(events.at(-1)).toMatchObject({ type: "run_finished", reachedDecision: false, needsHuman: true });
    // Every opened turn was closed exactly once.
    const starts = events.filter((e) => e.type === "thinking" && e.phase === "start").length;
    const closes = events.filter((e) => e.type === "thinking" && e.phase === "end").length;
    expect(closes).toBe(starts);
  });

  it("marks a tool that failed, with a short reason and no result", async () => {
    const turns = [
      { calls: [["get_order", { orderNumber: "#1001" }]] as [string, unknown][] },
      { calls: [["finish_case", { decision: "nonsense" }]] as [string, unknown][] },
      ...happyTurns().slice(3),
    ];
    const { events } = await run({ provider: scriptedProvider(turns) });
    const failed = ends(events).filter((e) => !e.ok);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]).toMatchObject({ tool: "finish_case", result: null });
    expect(typeof failed[0].error).toBe("string");
  });

  it("reports an order that was not found", async () => {
    const { events } = await run({ deps: fakeDeps({ getOrder: async () => null }) });
    const order = ends(events).find((e) => e.tool === "get_order");
    expect(order?.result).toEqual({ tool: "get_order", found: false, order: null });
  });

  it("says each guardrail adjustment as it applies", async () => {
    const turns = [
      ...happyTurns().slice(0, 3),
      { calls: [["finish_case", decisionArgs({ confidence: 0.3 })]] as [string, unknown][] },
      { calls: [["draft_claim_document", {}]] as [string, unknown][] },
    ];
    const { events } = await run({ provider: scriptedProvider(turns) });
    const guardrails = events.filter((e): e is Extract<AgentEvent, { type: "guardrail" }> => e.type === "guardrail");
    expect(guardrails.length).toBeGreaterThan(0);
    expect(guardrails[0].message).toMatch(/needsHuman/);
    // The guardrail comes while finish_case is running, before it ends.
    const at = events.indexOf(guardrails[0]);
    const startAt = events.findIndex((e) => e.type === "tool_start" && e.tool === "finish_case");
    const endAt = events.findIndex((e) => e.type === "tool_end" && e.tool === "finish_case");
    expect(at).toBeGreaterThan(startAt);
    expect(at).toBeLessThan(endAt);
  });

  it("says when the photos were not shown to the model", async () => {
    const provider = { ...scriptedProvider([{ calls: [["finish_case", decisionArgs({ needsHuman: true, carrierClaim: false, decision: "no_action" })]] }]), supportsImages: false };
    const { events } = await run({ provider });
    expect(events.find((e) => e.type === "notice")).toMatchObject({ code: "photos_withheld" });
  });

  it("shows the outline the CODE asked for when the model skipped it, as called by the code", async () => {
    const turns = [
      { calls: [["get_order", { orderNumber: "#1001" }]] as [string, unknown][] },
      { calls: [["assess_photos", ASSESSMENT_BROKEN], ["get_carrier_rules", { carrier: "colissimo" }]] as [string, unknown][] },
      { calls: [["compute_claim", {}]] as [string, unknown][] },
      { calls: [["finish_case", decisionArgs()]] as [string, unknown][] },
      { calls: [["draft_claim_document", {}]] as [string, unknown][] },
    ];
    const { events } = await run({ provider: scriptedProvider(turns) });
    const code = ends(events).find((e) => e.tool === "mark_damage");
    expect(code).toMatchObject({ calledBy: "code", ok: true, result: { regions: 2 } });
    // It runs inside the drafting of the claim, so it is announced between that tool's start and end.
    const draftStart = events.findIndex((e) => e.type === "tool_start" && e.tool === "draft_claim_document");
    const markEnd = events.indexOf(code!);
    const draftEnd = events.findIndex((e) => e.type === "tool_end" && e.tool === "draft_claim_document");
    expect(markEnd).toBeGreaterThan(draftStart);
    expect(markEnd).toBeLessThan(draftEnd);
  });
});

describe("runAgent events: the listener", () => {
  it("is optional: a run without one gives the same case", async () => {
    const withListener = await run();
    const without = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(happyTurns()),
      deps: depsWithStoredOutline(),
      now: NOW,
    });
    expect(without.decision).toEqual(withListener.c.decision);
    expect(without.claim).toEqual(withListener.c.claim);
  });

  it("cannot break the run, whatever it throws", async () => {
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(happyTurns()),
      deps: depsWithStoredOutline(),
      now: NOW,
      onEvent: () => {
        throw new Error("the stream is closed");
      },
    });
    expect(c.decision).toMatchObject({ decision: "reship", carrierClaim: true });
    expect(c.document).not.toBeNull();
  });
});

describe("runAgent events: the scripted mock", () => {
  it("says it is the mock and runs the real tools", async () => {
    const events: AgentEvent[] = [];
    const c = await runAgent(makeReport({ orderNumber: "#1001", customerEmail: "camille.laurent@example.com", message: "My vase arrived broken" }), {
      engine: "demo-mock",
      now: NOW,
      onEvent: (e) => events.push(e),
    });
    expect(events[0]).toMatchObject({ type: "run_started", engine: "demo-mock", model: "demo-mock", mock: true });
    expect(c.engine).toBe("demo-mock");
    // The mock's SAM step is a labelled non-result, never a fake outline.
    const mark = ends(events).find((e) => e.tool === "mark_damage");
    if (mark) expect(mark.result).toMatchObject({ method: "none", annotatedPath: null });
    expect(events.at(-1)).toMatchObject({ type: "run_finished" });
  });
});
