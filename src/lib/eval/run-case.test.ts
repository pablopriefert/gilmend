import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { ASSESSMENT_BROKEN, decisionArgs, fakeDeps, scriptedProvider } from "../agent/test-helpers";
import { loadDemoCases } from "../store/demo-cases";
import { runEvalCase } from "./run-case";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const demo = () => loadDemoCases(NOW)[0]; // the broken vase: reship + carrier claim expected

const happyTurns = () => [
  { calls: [["get_order", {}]] as [string, unknown][] },
  {
    calls: [
      ["assess_photos", ASSESSMENT_BROKEN],
      ["mark_damage", { photoIndex: 0 }],
      ["get_carrier_rules", { carrier: "colissimo" }],
    ] as [string, unknown][],
  },
  { calls: [["compute_claim", {}]] as [string, unknown][] },
  { calls: [["finish_case", decisionArgs()]] as [string, unknown][] },
  { calls: [["draft_claim_document", {}]] as [string, unknown][] },
];

/** A scripted provider whose every completion carries a usage block. */
function withUsage(provider: ReturnType<typeof scriptedProvider>) {
  const chat = provider.chat.bind(provider);
  provider.chat = async (...args): Promise<ChatCompletion> => ({
    ...(await chat(...args)),
    usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_tokens_details: { cached_tokens: 200 } },
  });
  return provider;
}

describe("runEvalCase", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("records the decision, the tokens and the calls of one real-loop run, and scores it", async () => {
    const provider = withUsage(scriptedProvider(happyTurns()));
    const run = await runEvalCase({
      demo: demo(),
      run: 2,
      engine: "muse-spark-1.3",
      provider,
      env: {},
      now: NOW,
      deps: fakeDeps({
        // A real-looking SAM outcome, so the evidence is read back from the note.
        markDamage: async (photo) => ({
          photo,
          annotatedPhoto: "data/runtime/x.jpg",
          method: "sam-3.1",
          note: 'SAM 3.1 outlined 3 regions matching "broken pottery" (confidence 0.9, 0.8, 0.7).',
        }),
      }),
    });

    expect(run).toMatchObject({
      run: 2,
      completed: true,
      failure: null,
      decision: "reship",
      carrierClaim: true,
      needsHuman: false,
      claimEligible: true,
      claimAmountEur: 32.2,
      claimDocument: true,
      modelCalls: 5,
      toolCalls: 7,
    });
    expect(run.usage).toEqual({ promptTokens: 5000, completionTokens: 500, totalTokens: 5500, cachedTokens: 1000, callsWithUsage: 5 });
    expect(run.sam).toMatchObject({ method: "sam-3.1", regions: 3, concepts: ["broken pottery"], calledByCode: false });
    expect(run.matches.all).toBe(true);
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("counts the SAM requests made through the evidence step", async () => {
    // markDamage reads the key from the process environment, as it does in a real run.
    vi.stubEnv("MODEL_API_KEY", "test-key-not-real");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const run = await runEvalCase({
      demo: demo(),
      run: 1,
      engine: "muse-spark-1.3",
      provider: scriptedProvider(happyTurns()),
      env: {},
      now: NOW,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      // The real markDamage, so the wrapper's fetch is the one SAM calls (every call fails: no region).
      deps: { ...fakeDeps(), markDamage: undefined },
    });
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
    expect(run.sam.requests).toBe(fetchImpl.mock.calls.length);
    expect(run.sam.method).toBe("none");
    expect(run.usage).toBeNull();
  });

  it("scores a run that disagrees with the expectation, and keeps the model's reasons", async () => {
    const turns = happyTurns();
    turns[3] = { calls: [["finish_case", decisionArgs({ decision: "no_action", carrierClaim: false, reasons: ["Looks fine."] })]] as [string, unknown][] };
    const run = await runEvalCase({ demo: demo(), run: 1, engine: "muse-spark-1.3", provider: scriptedProvider(turns), env: {}, now: NOW, deps: fakeDeps() });
    expect(run.decision).toBe("no_action");
    expect(run.matches).toMatchObject({ decision: false, carrierClaim: false, all: false });
    expect(run.reasons).toContain("Looks fine.");
  });

  it("marks a run that never reached a decision as not completed", async () => {
    const run = await runEvalCase({
      demo: demo(),
      run: 1,
      engine: "muse-spark-1.3",
      provider: scriptedProvider([{ throws: new Error("boom") }]),
      env: {},
      now: NOW,
      deps: fakeDeps(),
    });
    expect(run.completed).toBe(false);
    expect(run.failure).toMatch(/could not finish|did not reach a decision/i);
    expect(run.matches.all).toBe(false);
  });
});
