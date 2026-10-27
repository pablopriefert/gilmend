import { describe, expect, it } from "vitest";
import type { ChatCompletion, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { describeEngine } from "../config";
import type { ChatParams, Provider } from "../providers";
import type { AgentEvent } from "./events";
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

  it("refuses an assessment passed inline to compute_claim: no reading, no claim, a human", async () => {
    // compute_claim also takes an `assessment` argument: it must not become a way around the lock.
    const turns = () => [
      { calls: [["get_order", { orderNumber: "#1001" }]] as [string, unknown][] },
      { calls: [["compute_claim", { assessment: ASSESSMENT_BROKEN }]] as [string, unknown][] },
      { calls: [["finish_case", decisionArgs()]] as [string, unknown][] },
    ];
    const check = (c: Awaited<ReturnType<typeof runAgent>>) => {
      expect(c.assessment).toBeNull();
      expect(c.claim).toBeNull();
      const step = c.trace.find((t) => t.tool === "compute_claim");
      expect(JSON.stringify(step?.output)).toMatch(/not shown the photos/);
      expect(c.decision).toMatchObject({ carrierClaim: false, needsHuman: true });
      expect(c.document).toBeNull();
    };

    // OPEN_WEIGHTS_VISION=0
    const provider = withoutImages(scriptedProvider(turns()));
    check(await runAgent(makeReport(), { engine: "open-weights", provider, deps: fakeDeps(), now: NOW }));

    // The server refuses the photos (HTTP 400): same lock after the retry without them.
    const refusing = refusingFirst(400, turns());
    check(await runAgent(makeReport(), { engine: "open-weights", provider: refusing, deps: fakeDeps(), now: NOW }));
  });

  it("still sends the photos to a model that reads images (the default)", async () => {
    const provider = scriptedProvider([{ calls: [["finish_case", decisionArgs({ carrierClaim: false })]] }]);
    await runAgent(makeReport(), { engine: "muse-spark-1.3", provider, deps: fakeDeps(), now: NOW });
    expect(imageCount(provider.requests[0])).toBe(1);
  });
});

/** First request (with images) answers HTTP `status`; then it plays the script. */
function refusingFirst(status: number, turns: ReturnType<typeof claimTurns> = claimTurns()) {
  const inner = scriptedProvider(turns);
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

describe("runAgent: a server that refuses the photos", () => {
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

// What the live timeline is told about the photos (review of 28 Oct 2026): the page words "reading the
// photos" from run_started.photosSent and the photos_withheld notice, so they must be true.
describe("runAgent events: how many photos the model was really shown", () => {
  const collect = (): { events: AgentEvent[]; onEvent: (e: AgentEvent) => void } => {
    const events: AgentEvent[] = [];
    return { events, onEvent: (e) => events.push(e) };
  };
  const startedOf = (events: AgentEvent[]) => events.find((e) => e.type === "run_started") as Extract<AgentEvent, { type: "run_started" }>;
  const finishOnly = () => [{ calls: [["finish_case", decisionArgs({ carrierClaim: false })]] as [string, unknown][] }];

  it("says every photo was sent when the model reads images", async () => {
    const { events, onEvent } = collect();
    await runAgent(makeReport(), { engine: "muse-spark-1.3", provider: scriptedProvider(finishOnly()), deps: fakeDeps(), now: NOW, onEvent });
    expect(startedOf(events)).toMatchObject({ photos: 1, photosSent: 1 });
    expect(events.some((e) => e.type === "notice")).toBe(false);
  });

  it("says none was sent to a text-only model, and says so in a notice that comes with it", async () => {
    const { events, onEvent } = collect();
    const provider = withoutImages(scriptedProvider(claimTurns()));
    await runAgent(makeReport(), { engine: "open-weights", provider, deps: fakeDeps(), now: NOW, onEvent });
    expect(startedOf(events)).toMatchObject({ photos: 1, photosSent: 0 });
    const notice = events.find((e) => e.type === "notice");
    expect(notice).toMatchObject({ code: "photos_withheld" });
    // Both are known before the first model turn starts.
    const first = events.findIndex((e) => e.type === "thinking");
    expect(events.indexOf(notice!)).toBeLessThan(first);
    expect(events.indexOf(startedOf(events))).toBeLessThan(first);
  });

  it("counts only the photos that could be read, and notices the one that could not", async () => {
    const { events, onEvent } = collect();
    const report = makeReport({ photos: ["data:image/png;base64,AAAA", "data/this-photo-does-not-exist.png"] });
    await runAgent(report, { engine: "muse-spark-1.3", provider: scriptedProvider(finishOnly()), deps: fakeDeps(), now: NOW, onEvent });
    expect(startedOf(events)).toMatchObject({ photos: 2, photosSent: 1 });
    expect(events.find((e) => e.type === "notice")).toMatchObject({ code: "photo_unreadable" });
  });

  it("starts with the photos sent, then withholds them in the middle of turn 1 when the server refuses the images", async () => {
    const { events, onEvent } = collect();
    await runAgent(makeReport(), { engine: "open-weights", provider: refusingFirst(400), deps: fakeDeps(), now: NOW, onEvent });
    // The first request really carried the photo, so run_started says 1...
    expect(startedOf(events)).toMatchObject({ photos: 1, photosSent: 1 });
    // ...and the notice lands between the start and the end of the same turn: the page must reword that row.
    const types = events.map((e) => (e.type === "thinking" ? `thinking:${e.turn}:${e.phase}` : e.type));
    const start = types.indexOf("thinking:1:start");
    const notice = types.indexOf("notice");
    const end = types.indexOf("thinking:1:end");
    expect(start).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(notice);
    expect(events[notice]).toMatchObject({ code: "photos_withheld" });
  });
});
