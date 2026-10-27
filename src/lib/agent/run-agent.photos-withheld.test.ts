import { describe, expect, it } from "vitest";
import type { ChatCompletion, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { describeEngine } from "../config";
import type { ChatParams, Provider } from "../providers";
import { runAgent } from "./run-agent";
import { ASSESSMENT_BROKEN, NOW, decisionArgs, fakeDeps, makeReport, scriptedProvider } from "./test-helpers";

// An open-weights model that cannot read images (OPEN_WEIGHTS_VISION=0), or whose server refuses
// them, must never end up "reading" the photos: the run goes on without them, says so in the
// trace, and the case goes to a human with no carrier claim.

type Part = { type: string; text?: string };
const partsOf = (m: ChatCompletionMessageParam): Part[] => (Array.isArray(m.content) ? (m.content as Part[]) : []);
const imageCount = (p: ChatParams) => partsOf(p.messages[1]).filter((x) => x.type === "image_url").length;

const claimTurns = () => [
  { calls: [["get_order", { orderNumber: "#1001" }]] as [string, unknown][] },
  // A model that ignores the note and "assesses" photos it never saw.
  { calls: [["assess_photos", ASSESSMENT_BROKEN]] as [string, unknown][] },
  { calls: [["finish_case", decisionArgs()]] as [string, unknown][] },
];

function withoutImages(provider: ReturnType<typeof scriptedProvider>): ReturnType<typeof scriptedProvider> {
  provider.supportsImages = false;
  provider.engine = "open-weights";
  provider.detail = describeEngine("open-weights", {
    OPEN_WEIGHTS_PROVIDER: "baseten",
    BASETEN_API_KEY: "placeholder",
  });
  return provider;
}

describe("runAgent: a model that cannot read the photos", () => {
  it("does not send the images, tells the model, and says so in the trace", async () => {
    const provider = withoutImages(scriptedProvider(claimTurns()));
    const c = await runAgent(makeReport(), { engine: "open-weights", provider, deps: fakeDeps(), now: NOW });

    expect(provider.requests.every((r) => imageCount(r) === 0)).toBe(true);
    const parts = partsOf(provider.requests[0].messages[1]);
    expect(parts[0].text).toContain("Photos attached to this message (index in photo_index): none");
    expect(parts.map((p) => p.text).join("\n")).toMatch(/photos were NOT shown to you/);
    expect(c.trace.map((t) => t.step).join("\n")).toMatch(/photos were NOT read by the model/);
    // The trace line names the cause, so the merchant can fix it.
    expect(c.trace.map((t) => t.step).join("\n")).toMatch(/configured without image input/);
  });

  it("records no reading, drops the carrier claim, drafts no document and forces a human", async () => {
    const provider = withoutImages(scriptedProvider(claimTurns()));
    const deps = fakeDeps();
    const c = await runAgent(makeReport(), { engine: "open-weights", provider, deps, now: NOW });

    // The model "assessed" photos it never saw: the reading is refused, not stored.
    expect(c.assessment).toBeNull();
    const assessStep = c.trace.find((t) => t.tool === "assess_photos");
    expect(JSON.stringify(assessStep?.output)).toMatch(/not shown the photos/);
    expect(c.decision).toMatchObject({ carrierClaim: false, needsHuman: true });
    expect(c.decision?.reasons.join(" ")).toMatch(/photos were not read by the model/);
    expect(c.document).toBeNull();
  });

  it("still sends the photos to a model that reads images (the default)", async () => {
    const provider = scriptedProvider([{ calls: [["finish_case", decisionArgs({ carrierClaim: false })]] }]);
    await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps(), now: NOW });
    expect(imageCount(provider.requests[0])).toBe(1);
  });
});

describe("runAgent: a server that refuses the photos", () => {
  /** First request (with images) answers HTTP `status`; then it plays the script. */
  function refusingFirst(status: number) {
    const inner = scriptedProvider(claimTurns());
    const sent: ChatParams[] = [];
    let calls = 0;
    const provider: Provider & { sent: ChatParams[] } = {
      engine: "open-weights",
      model: "fake",
      isMock: false,
      sent,
      async chat(params: ChatParams, options?: { timeoutMs?: number }): Promise<ChatCompletion> {
        sent.push({ ...params, messages: structuredClone(params.messages) as ChatCompletionMessageParam[] });
        if (calls++ === 0) throw Object.assign(new Error(`${status} image input is not supported`), { status });
        return inner.chat(params, options);
      },
    };
    return provider;
  }

  it("retries once without the photos, out loud, and sends the case to a human", async () => {
    const provider = refusingFirst(400);
    const c = await runAgent(makeReport(), { engine: "open-weights", provider, deps: fakeDeps(), now: NOW });

    expect(imageCount(provider.sent[0])).toBe(1);
    expect(imageCount(provider.sent[1])).toBe(0);
    const steps = c.trace.map((t) => t.step).join("\n");
    expect(steps).toMatch(/server answered HTTP 400 to the request with photos/);
    expect(steps).toMatch(/photos were NOT read by the model/);
    expect(c.decision).toMatchObject({ carrierClaim: false, needsHuman: true });
  });

  it("does not retry on a server error that has nothing to do with images", async () => {
    const provider = refusingFirst(500);
    const c = await runAgent(makeReport(), { engine: "open-weights", provider, deps: fakeDeps(), now: NOW });
    expect(provider.sent).toHaveLength(1);
    expect(c.decision?.needsHuman).toBe(true);
    expect(c.trace.map((t) => t.step).join("\n")).toMatch(/model call failed at step 1/);
  });
});

describe("runAgent: the case says which model and host ran it", () => {
  it("stores the engine detail of the provider on the case and in the trace", async () => {
    const provider = withoutImages(scriptedProvider([{ calls: [["finish_case", decisionArgs({ carrierClaim: false })]] }]));
    const c = await runAgent(makeReport(), { engine: "open-weights", provider, deps: fakeDeps(), now: NOW });
    expect(c.engineDetail).toMatchObject({ host: "baseten", label: "Muse Spark Open (open weights, served by Baseten)" });
    expect(c.trace[0].step).toBe("Engine: open-weights (Muse Spark Open (open weights, served by Baseten))");
  });
});
