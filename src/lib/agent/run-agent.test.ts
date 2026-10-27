import { describe, expect, it, vi } from "vitest";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { computeClaim as realComputeClaim } from "../rules/carriers";
import { runAgent } from "./run-agent";
import {
  ASSESSMENT_BROKEN,
  NOW,
  decisionArgs,
  fakeDeps,
  makeOrder,
  makeReport,
  scriptedProvider,
} from "./test-helpers";
import { AGENT_TOOLS, DECISION_JSON_SCHEMA, TRACE_TOOL_NAME, parseDecision } from "./tools";

const happyTurns = () => [
  { calls: [["get_order", { orderNumber: "#1001" }]] as [string, unknown][] },
  {
    calls: [
      ["mark_damage", { photoIndex: 0 }],
      ["get_carrier_rules", { carrier: "colissimo" }],
    ] as [string, unknown][],
  },
  { calls: [["compute_claim", { assessment: ASSESSMENT_BROKEN }]] as [string, unknown][] },
  { calls: [["finish_case", decisionArgs()]] as [string, unknown][] },
  { calls: [["draft_claim_document", {}]] as [string, unknown][] },
];

const toolNamesInTrace = (c: { trace: { tool?: string }[] }) =>
  c.trace.map((t) => t.tool).filter(Boolean);

describe("runAgent: a weak-packaging reading (27 Oct 2026)", () => {
  it("keeps the claim and its PDF, warns the merchant, and asks for a human", async () => {
    const turns = happyTurns();
    turns[2] = {
      calls: [["compute_claim", { assessment: { ...ASSESSMENT_BROKEN, packagingAdequate: false } }]] as [string, unknown][],
    };
    const provider = scriptedProvider(turns);
    // The real claim maths: this is the code path that used to drop the claim.
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({ computeClaim: (...a) => realComputeClaim(...a) }),
      now: NOW,
    });
    expect(c.claim?.eligible).toBe(true);
    expect(c.claim?.maxCompensationEur).toBeGreaterThan(0);
    expect(c.claim?.reasons.join(" ")).toMatch(/packaging may be judged inadequate/);
    expect(c.decision).toMatchObject({ decision: "reship", carrierClaim: true, needsHuman: true });
    expect(c.decision?.reasons.join(" ")).toMatch(/Guardrail: the photos suggest the packaging/);
    expect(c.document).not.toBeNull();
  });
});

describe("runAgent: tool loop", () => {
  it("runs the whole loop for an order that exists and builds the claim", async () => {
    const provider = scriptedProvider(happyTurns());
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps(), now: NOW });

    expect(c.status).toBe("needs_review");
    expect(c.engine).toBe("muse-spark-1.3");
    expect(c.order?.id).toBe("#1001");
    expect(c.assessment?.damageType).toBe("broken_product");
    expect(c.claim?.eligible).toBe(true);
    expect(c.decision).toMatchObject({ decision: "reship", carrierClaim: true, needsHuman: false });
    expect(c.evidence).toHaveLength(1);
    expect(c.evidence[0].method).toBe("sam-3.1");
    expect(c.document?.pdfPath).toBe("data/runtime/claim.pdf");
    expect(toolNamesInTrace(c)).toEqual([
      "get_order",
      "mark_damage",
      "carrier_rules",
      "compute_claim",
      "draft_reply",
      "draft_claim",
    ]);
    expect(provider.requests).toHaveLength(5);
  });

  it("sends the photos as image_url parts and the customer text as delimited data", async () => {
    const provider = scriptedProvider([{ calls: [["finish_case", decisionArgs({ carrierClaim: false })]] }]);
    await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps() });
    const first = provider.requests[0];
    expect(first.messages[0].role).toBe("system");
    const user = first.messages[1];
    expect(Array.isArray(user.content)).toBe(true);
    const parts = user.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0].type).toBe("text");
    expect(parts[0].text).toContain("<customer_message>");
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
    expect(first.tools).toBe(AGENT_TOOLS);
  });

  it("answers every tool call of a turn, in order (strict servers reject anything else)", async () => {
    const provider = scriptedProvider(happyTurns());
    await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps(), now: NOW });
    const second = provider.requests[2].messages; // request 3 includes turn 2 and its answers
    const asst = second.filter((m): m is Extract<ChatCompletionMessageParam, { role: "assistant" }> => m.role === "assistant");
    const toolMsgs = second.filter((m): m is Extract<ChatCompletionMessageParam, { role: "tool" }> => m.role === "tool");
    const ids = asst.flatMap((a) => (a.tool_calls ?? []).map((t) => t.id));
    expect(toolMsgs.map((t) => t.tool_call_id)).toEqual(ids);
  });

  it("uses the report's e-mail for the lookup, whatever the model asks", async () => {
    const getOrder = vi.fn(async () => makeOrder());
    const provider = scriptedProvider([
      { calls: [["get_order", { orderNumber: "#1001", email: "victim@example.com" }]] },
      { calls: [["finish_case", decisionArgs({ carrierClaim: false })]] },
    ]);
    await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps({ getOrder }) });
    expect(getOrder).toHaveBeenCalledWith("#1001", "ada@example.com");
  });

  it("passes the report timestamp and the injected clock to compute_claim, never model dates", async () => {
    const computeClaim = vi.fn(() => ({
      eligible: true, reasons: [], maxCompensationEur: 10, claimDeadline: null, reserveDeadline: null, daysLeft: null,
    }));
    const provider = scriptedProvider([
      { calls: [["get_order", {}]] },
      { calls: [["compute_claim", { assessment: ASSESSMENT_BROKEN, reportReceivedAt: "1999-01-01", now: "1999-01-01" }]] },
      { calls: [["finish_case", decisionArgs({ carrierClaim: false })]] },
    ]);
    await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps({ computeClaim }), now: NOW });
    const args = computeClaim.mock.calls[0] as unknown as unknown[];
    expect(args[2]).toBe("2026-10-27T10:00:00.000Z");
    expect(args[3]).toBe(NOW);
  });

  it("keeps photos out of the tool results sent back to the model and out of the trace", async () => {
    const provider = scriptedProvider(happyTurns());
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps(), now: NOW });
    const everythingSent = JSON.stringify(provider.requests[2].messages.filter((m) => m.role === "tool"));
    expect(everythingSent).not.toContain("BBBB");
    expect(JSON.stringify(c.trace)).not.toContain("AAAA");
    expect(JSON.stringify(c.trace)).not.toContain("BBBB");
  });
});

describe("runAgent: cases", () => {
  it("order not found: needs a human, no claim, no document", async () => {
    const provider = scriptedProvider([
      { calls: [["get_order", {}]] },
      {
        calls: [["finish_case", decisionArgs({ decision: "no_action", reasons: ["Order not found."] })]],
      },
    ]);
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({ getOrder: async () => null }),
    });
    expect(c.order).toBeNull();
    expect(c.decision).toMatchObject({ decision: "no_action", carrierClaim: false, needsHuman: true });
    expect(c.document).toBeNull();
    expect(c.status).toBe("needs_review");
  });

  it("compute_claim before an order is loaded is refused with an instruction, not a crash", async () => {
    const provider = scriptedProvider([
      { calls: [["compute_claim", { assessment: ASSESSMENT_BROKEN }]] },
      { calls: [["finish_case", decisionArgs({ carrierClaim: false })]] },
    ]);
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps() });
    expect(c.trace.some((t) => t.step === "Tool error: compute_claim")).toBe(true);
    expect(c.decision?.needsHuman).toBe(true); // order never loaded
  });

  it("blurry photo: asks for another photo and files no claim", async () => {
    const provider = scriptedProvider([
      { calls: [["get_order", {}]] },
      {
        calls: [
          ["compute_claim", { assessment: { ...ASSESSMENT_BROKEN, damageType: "unclear", severity: "minor", photoQuality: "blurry" } }],
        ],
      },
      {
        calls: [
          ["finish_case", decisionArgs({ decision: "ask_more_photos", carrierClaim: true, customerReply: "Could you send a sharper photo?" })],
        ],
      },
    ]);
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps() });
    expect(c.decision).toMatchObject({ decision: "ask_more_photos", carrierClaim: false, needsHuman: false });
    expect(c.document).toBeNull();
  });

  it("blurry photo but a reship decision: forced to a human", async () => {
    const provider = scriptedProvider([
      { calls: [["get_order", {}]] },
      { calls: [["compute_claim", { assessment: { ...ASSESSMENT_BROKEN, photoQuality: "blurry" } }]] },
      { calls: [["finish_case", decisionArgs()]] },
    ]);
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps() });
    expect(c.decision?.needsHuman).toBe(true);
  });

  it("high value order (> 300 EUR): needsHuman even when the model is confident", async () => {
    const provider = scriptedProvider(happyTurns());
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({ getOrder: async () => makeOrder({ total: 450 }) }),
      now: NOW,
    });
    expect(c.decision?.needsHuman).toBe(true);
    expect(c.decision?.reasons.join(" ")).toMatch(/above 300 EUR/);
    // The claim itself is still prepared for the merchant to review.
    expect(c.document).not.toBeNull();
  });

  it("claim not eligible (too late): the model's carrierClaim=true is dropped", async () => {
    const provider = scriptedProvider([
      { calls: [["get_order", {}]] },
      { calls: [["compute_claim", { assessment: ASSESSMENT_BROKEN }]] },
      { calls: [["finish_case", decisionArgs({ decision: "refund" })]] },
    ]);
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({
        computeClaim: () => ({ eligible: false, reasons: ["Deadline passed."], maxCompensationEur: 0, claimDeadline: null, reserveDeadline: null, daysLeft: null }),
      }),
    });
    expect(c.decision).toMatchObject({ decision: "refund", carrierClaim: false });
    expect(c.document).toBeNull();
  });

  it("an amount invented by the model in the reply is blocked for human review", async () => {
    const provider = scriptedProvider([
      { calls: [["get_order", {}]] },
      { calls: [["compute_claim", { assessment: ASSESSMENT_BROKEN }]] },
      { calls: [["finish_case", decisionArgs({ carrierClaim: false, customerReply: "We refund 999 EUR today." })]] },
    ]);
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps() });
    expect(c.decision?.needsHuman).toBe(true);
  });

  it("drafts the claim document itself when the model decided a claim but stopped", async () => {
    const turns = happyTurns().slice(0, 4);
    turns.push({ calls: [] }); // model ends its turn in plain text instead of drafting
    const provider = scriptedProvider(turns);
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps(), now: NOW });
    expect(c.document).not.toBeNull();
    expect(c.trace.some((t) => t.step.includes("automatic"))).toBe(true);
  });
});

describe("runAgent: errors never crash", () => {
  it("a throwing tool is reported to the model, traced, and forces a human", async () => {
    const provider = scriptedProvider([
      { calls: [["get_order", {}]] },
      { calls: [["compute_claim", { assessment: ASSESSMENT_BROKEN }]] },
      { calls: [["finish_case", decisionArgs()]] },
    ]);
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({
        computeClaim: () => {
          throw new Error("rules file missing");
        },
      }),
    });
    expect(c.trace.find((t) => t.step === "Tool error: compute_claim")).toBeTruthy();
    expect(c.decision?.needsHuman).toBe(true);
    expect(c.decision?.carrierClaim).toBe(false);
    expect(c.status).toBe("needs_review");
    const toolMsg = provider.requests[2].messages.filter((m) => m.role === "tool").pop();
    expect(JSON.stringify(toolMsg)).toContain("rules file missing");
  });

  it("a failing order lookup does not crash the case", async () => {
    const provider = scriptedProvider([
      { calls: [["get_order", {}]] },
      { calls: [["finish_case", decisionArgs({ decision: "no_action", carrierClaim: false })]] },
    ]);
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({ getOrder: async () => { throw new Error("Shopify 500"); } }),
    });
    expect(c.decision?.needsHuman).toBe(true);
    expect(JSON.stringify(c.trace)).toContain("Shopify 500");
  });

  it("mark_damage failure is not fatal: the claim ships with the raw photo", async () => {
    const provider = scriptedProvider(happyTurns());
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({
        markDamage: async (photo) => ({ photo, annotatedPhoto: null, method: "none", note: "SAM unavailable" }),
      }),
      now: NOW,
    });
    expect(c.evidence[0]).toMatchObject({ annotatedPhoto: null, method: "none" });
    expect(c.decision?.needsHuman).toBe(false);
    expect(c.document).not.toBeNull();
  });

  it("a mark_damage that throws is turned into raw-photo evidence", async () => {
    const provider = scriptedProvider(happyTurns());
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({ markDamage: async () => { throw new Error("boom"); } }),
      now: NOW,
    });
    expect(c.evidence[0].method).toBe("none");
    expect(c.evidence[0].note).toContain("boom");
  });

  it("a claim document failure flags the case for the merchant", async () => {
    const provider = scriptedProvider(happyTurns());
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({ buildClaimDocument: async () => { throw new Error("pdf failed"); } }),
      now: NOW,
    });
    expect(c.document).toBeNull();
    expect(c.decision?.needsHuman).toBe(true);
    expect(c.decision?.reasons.join(" ")).toContain("could not be generated");
  });

  it("a model call that throws returns a needs_review case with the error in the trace", async () => {
    const provider = scriptedProvider([{ calls: [["get_order", {}]] }, { throws: new Error("502 bad gateway") }]);
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps() });
    expect(c.status).toBe("needs_review");
    expect(c.decision).toMatchObject({ needsHuman: true, carrierClaim: false, confidence: 0 });
    expect(c.trace.some((t) => t.step.includes("502 bad gateway"))).toBe(true);
  });

  it("invalid JSON arguments are returned to the model, which can retry", async () => {
    const provider = scriptedProvider([
      { rawCalls: [["get_order", "{not json"]] },
      { calls: [["get_order", {}]] },
      { calls: [["finish_case", decisionArgs({ carrierClaim: false })]] },
    ]);
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps() });
    expect(c.trace.some((t) => t.step === "Tool error: get_order")).toBe(true);
    expect(c.order).not.toBeNull();
  });

  it("an unknown tool is answered with an error, not skipped", async () => {
    const provider = scriptedProvider([
      { calls: [["delete_everything", {}]] },
      { calls: [["finish_case", decisionArgs({ carrierClaim: false })]] },
    ]);
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps() });
    const answered = provider.requests[1].messages.filter((m) => m.role === "tool");
    expect(answered).toHaveLength(1);
    expect(JSON.stringify(answered[0])).toContain("Unknown tool");
    expect(c.decision).not.toBeNull();
  });

  it("an invalid decision is rejected and the model may correct it", async () => {
    const provider = scriptedProvider([
      { calls: [["get_order", {}]] },
      { calls: [["finish_case", { decision: "pay_double", confidence: 5 }]] },
      { calls: [["finish_case", decisionArgs({ carrierClaim: false })]] },
    ]);
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps() });
    expect(c.decision?.decision).toBe("reship");
  });

  it("stops after the step limit and hands the case to a human", async () => {
    const provider = scriptedProvider(Array.from({ length: 20 }, () => ({ calls: [["get_order", {}]] as [string, unknown][] })));
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps(), maxSteps: 3 });
    expect(provider.requests).toHaveLength(3);
    expect(c.decision).toMatchObject({ needsHuman: true, carrierClaim: false });
    expect(c.trace.some((t) => t.step.includes("did not reach a decision"))).toBe(true);
  });

  it("nudges a model that answers in plain text, once, then gives up", async () => {
    const provider = scriptedProvider([{ content: "I think it is broken." }, { content: "Still thinking." }]);
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps() });
    expect(provider.requests).toHaveLength(2);
    expect(c.decision?.needsHuman).toBe(true);
  });

  it("an unreadable photo is skipped with a trace line, not sent", async () => {
    const provider = scriptedProvider([{ calls: [["finish_case", decisionArgs({ carrierClaim: false })]] }]);
    const c = await runAgent(makeReport({ photos: ["../../etc/passwd"] }), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps(),
    });
    const user = provider.requests[0].messages[1].content as { type: string }[];
    expect(user.filter((p) => p.type === "image_url")).toHaveLength(0);
    expect(c.trace.some((t) => t.step.includes("could not be read"))).toBe(true);
  });
});

describe("runAgent: engine labelling", () => {
  it("falls back to the labelled mock when the requested engine has no key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = await runAgent(makeReport(), { engine: "muse-spark-1.3", env: {}, deps: fakeDeps(), now: NOW });
    warn.mockRestore();
    expect(c.engine).toBe("demo-mock");
    expect(c.trace[0].step).toMatch(/DEMO MODE/);
    expect(c.trace[0].step).toMatch(/not come from Muse/i);
  });

  it("a provider that cannot be built (bad config) still yields a case", async () => {
    const c = await runAgent(makeReport(), {
      engine: "open-weights",
      env: { OPEN_WEIGHTS_BASE_URL: "https://x.invalid/v1", OPEN_WEIGHTS_MODEL: "muse-spark-1.3-contributor" },
      deps: fakeDeps(),
    });
    expect(c.engine).toBe("open-weights");
    expect(c.decision?.needsHuman).toBe(true);
    expect(JSON.stringify(c.trace)).toMatch(/Contributor/);
  });
});

describe("tool schemas and the Decision contract", () => {
  it("exposes exactly the seven tools, with function-name-safe identifiers", () => {
    const names = AGENT_TOOLS.map((t) => t.function.name);
    expect(names).toEqual([
      "get_order",
      "assess_photos",
      "mark_damage",
      "get_carrier_rules",
      "compute_claim",
      "finish_case",
      "draft_claim_document",
    ]);
    for (const n of names) expect(n).toMatch(/^[a-zA-Z0-9_.-]+$/);
    expect(Object.keys(TRACE_TOOL_NAME).sort()).toEqual([...names].sort());
  });

  it("DECISION_JSON_SCHEMA covers the Decision fields and carries no money or date", () => {
    const props = Object.keys(DECISION_JSON_SCHEMA.properties);
    for (const f of ["decision", "carrierClaim", "confidence", "reasons", "needsHuman", "customerReply"]) {
      expect(props).toContain(f);
    }
    expect(props.some((p) => /amount|compensation|deadline|date|eur/i.test(p))).toBe(false);
    expect(DECISION_JSON_SCHEMA.properties.decision.enum).toEqual(["reship", "refund", "ask_more_photos", "no_action"]);
    expect(DECISION_JSON_SCHEMA.required).toEqual(expect.arrayContaining(["decision", "carrierClaim", "confidence", "reasons", "needsHuman", "customerReply"]));
    // the schema is plain JSON (it is sent over the wire)
    expect(JSON.parse(JSON.stringify(DECISION_JSON_SCHEMA))).toEqual(DECISION_JSON_SCHEMA);
  });

  it("parseDecision validates every field and clamps confidence", () => {
    expect(parseDecision(decisionArgs()).ok).toBe(true);
    expect(parseDecision(decisionArgs({ decision: "pay_double" })).ok).toBe(false);
    expect(parseDecision(decisionArgs({ confidence: "high" })).ok).toBe(false);
    expect(parseDecision(decisionArgs({ reasons: [] })).ok).toBe(false);
    expect(parseDecision(decisionArgs({ needsHuman: "no" })).ok).toBe(false);
    const clamped = parseDecision(decisionArgs({ confidence: 4 }));
    expect(clamped.ok && clamped.value.confidence).toBe(1);
    // a weaker model may omit fraudSuspected
    const noFraud = decisionArgs();
    delete noFraud.fraudSuspected;
    expect(parseDecision(noFraud).ok).toBe(true);
  });
});
