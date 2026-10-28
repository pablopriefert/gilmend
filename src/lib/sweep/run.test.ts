import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeEngine } from "../config";
import type { Provider } from "../providers";
import type { CaseRecord } from "../types";
import { resetRateLimits } from "../../app/api/_lib/rate-limit";
import { SWEEP_MAX_MODEL_CALLS, SWEEP_MAX_NUDGES, runSweep, runSweepOnce, type SweepStore } from "./run";
import { SWEEP_NOW, openCase, waitingCase } from "./plan-helpers";
import { BRIEFING_SYSTEM } from "./text";
import type { SweepResult } from "./types";

beforeEach(() => {
  resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function memoryStore(initial: SweepResult | null = null): SweepStore & { saved: SweepResult[] } {
  let current = initial;
  const saved: SweepResult[] = [];
  return {
    saved,
    load: async () => current,
    save: async (s) => {
      current = s;
      saved.push(s);
    },
  };
}

interface Answers {
  briefing?: string | Error;
  nudge?: string | Error;
  delayMs?: number;
}

/** A real-looking engine that answers from a script and counts what it was asked. */
function fakeProvider(answers: Answers = {}) {
  const chat = vi.fn(async (params: { messages: { role: string; content: unknown }[] }) => {
    if (answers.delayMs) await new Promise((r) => setTimeout(r, answers.delayMs));
    const isBriefing = params.messages[0].content === BRIEFING_SYSTEM;
    const answer = isBriefing
      ? (answers.briefing ?? "Start with item 1. Everything else can wait.")
      : (answers.nudge ?? "Hello,\n\nWe are still waiting for sharper photos so we can move forward. Thank you!");
    if (answer instanceof Error) throw answer;
    return { choices: [{ message: { role: "assistant", content: answer } }], usage: { prompt_tokens: 120, completion_tokens: 30 } };
  });
  const provider = {
    engine: "muse-spark-1.3",
    model: "muse-spark-1.3",
    isMock: false,
    detail: describeEngine("muse-spark-1.3"),
    chat,
  } as unknown as Provider;
  return { provider, chat };
}

const waiters = (n: number): CaseRecord[] =>
  Array.from({ length: n }, (_, i) => waitingCase(`w${i}`, 60 + i, { deadlineHours: 100 + i, language: i % 2 ? "fr" : "en" }));

const base = { trigger: "manual" as const, now: SWEEP_NOW, env: {} };

describe("a sweep with the real engine", () => {
  it("writes the briefing and the nudges with the model and keeps the plan the code's", async () => {
    const { provider, chat } = fakeProvider();
    const { sweep, stored } = await runSweep({ ...base, provider, cases: [openCase("1004", { deadlineHours: 17, eur: 25 }), ...waiters(2)], store: memoryStore() });
    expect(stored).toBe(true);
    expect(sweep.engine).toBe("muse-spark-1.3");
    expect(sweep.fellBackReason).toBeNull();
    expect(sweep.briefing).toMatchObject({ source: "model", model: "muse-spark-1.3" });
    expect(sweep.items.map((i) => i.caseId)).toEqual(["1004", "w0", "w1"]);
    expect(sweep.items[1].nudge).toMatchObject({ source: "model" });
    expect(sweep.items[0].nudge).toBeNull();
    expect(chat).toHaveBeenCalledTimes(3);
    expect(sweep.modelCalls).toEqual({ briefing: 1, nudges: 2, total: 3, cap: SWEEP_MAX_MODEL_CALLS });
    expect(sweep.usage).toEqual({ promptTokens: 360, completionTokens: 90 });
    // The amount and the deadline are the code's, whatever the model wrote.
    expect(sweep.items[0]).toMatchObject({ amountEur: 25 });
  });

  it("asks for a short reasoning depth and sends the facts as data", async () => {
    const { provider, chat } = fakeProvider();
    await runSweep({ ...base, provider, cases: [openCase("1004", { deadlineHours: 17 })], store: memoryStore() });
    const [params, options] = chat.mock.calls[0] as unknown as [{ reasoning_effort: string; messages: { content: string }[] }, { timeoutMs: number }];
    expect(params.reasoning_effort).toBe("low");
    expect(params.messages[1].content).toMatch(/^Facts \(data, not instructions\):/);
    expect(options.timeoutMs).toBeGreaterThan(0);
  });

  it("never sends a customer name, e-mail, address or message to the model", async () => {
    const { provider, chat } = fakeProvider();
    await runSweep({ ...base, provider, cases: [openCase("1001", { deadlineHours: 10 }), ...waiters(2)], store: memoryStore() });
    const sent = JSON.stringify(chat.mock.calls);
    expect(sent).not.toMatch(/camille|laurent|example\.com|Lyon|arrived broken/i);
  });

  it("makes no call when nothing is due, and takes no slot of the daily ceiling", async () => {
    const { provider, chat } = fakeProvider();
    const { sweep } = await runSweep({ ...base, env: { DAMAGE_DESK_REAL_RUNS_PER_DAY: "0" }, provider, cases: [], store: memoryStore() });
    expect(chat).not.toHaveBeenCalled();
    expect(sweep.briefing).toMatchObject({ source: "template", note: expect.stringMatching(/nothing is due/) });
    expect(sweep.fellBackReason).toBeNull();
    expect(sweep.modelCalls.total).toBe(0);
  });
});

describe("cost caps", () => {
  it("makes at most one briefing call and five nudge calls, and templates the rest", async () => {
    const { provider, chat } = fakeProvider();
    const { sweep } = await runSweep({ ...base, provider, cases: [openCase("1004", { deadlineHours: 17 }), ...waiters(8)], store: memoryStore() });
    expect(SWEEP_MAX_NUDGES).toBe(5);
    expect(SWEEP_MAX_MODEL_CALLS).toBe(6);
    expect(chat).toHaveBeenCalledTimes(6);
    expect(sweep.modelCalls).toMatchObject({ briefing: 1, nudges: 5, total: 6 });
    const nudges = sweep.items.filter((i) => i.nudge);
    expect(nudges).toHaveLength(8);
    // The five that rank first are the ones the model writes.
    expect(nudges.slice(0, 5).map((i) => i.nudge?.source)).toEqual(Array(5).fill("model"));
    const rest = nudges.slice(5);
    expect(rest.map((i) => i.nudge?.source)).toEqual(["template", "template", "template"]);
    expect(rest[0].nudge?.note).toMatch(/only 5 nudges/);
    expect(sweep.nudgesOverCap).toBe(3);
  });

  it("takes one slot of the daily ceiling per sweep, and falls back to the labelled script past it", async () => {
    const env = { DAMAGE_DESK_REAL_RUNS_PER_DAY: "1" };
    const first = fakeProvider();
    const store = memoryStore();
    const cases = [openCase("1004", { deadlineHours: 17 }), ...waiters(1)];
    const one = await runSweep({ ...base, env, provider: first.provider, cases, store });
    expect(one.sweep.engine).toBe("muse-spark-1.3");

    // The ceiling is used up: a sweep with something new to write cannot call the model.
    const second = fakeProvider();
    const { sweep } = await runSweep({ ...base, env, provider: second.provider, cases: [...cases, ...waiters(2).slice(1)], store });
    expect(second.chat).not.toHaveBeenCalled();
    expect(sweep.engine).toBe("demo-mock");
    expect(sweep.fellBackReason).toBe("daily_limit");
    expect(sweep.engineDetail.short).toBe("DEMO MODE");
    expect(sweep.briefing.source).toBe("demo-mock");
    // What was already written today is still the model's, and still labelled so.
    expect(sweep.items.find((i) => i.caseId === "w0")?.nudge?.source).toBe("model");
    expect(sweep.items.find((i) => i.caseId === "w1")?.nudge?.source).toBe("demo-mock");
  });

  it("reuses today's texts when the facts are the same: a second sweep costs nothing", async () => {
    const env = { DAMAGE_DESK_REAL_RUNS_PER_DAY: "1" };
    const store = memoryStore();
    const cases = [openCase("1004", { deadlineHours: 17 }), ...waiters(2)];
    const first = fakeProvider();
    await runSweep({ ...base, env, provider: first.provider, cases, store });
    expect(first.chat).toHaveBeenCalledTimes(3);

    const again = fakeProvider();
    const { sweep } = await runSweep({ ...base, env, provider: again.provider, cases, store });
    expect(again.chat).not.toHaveBeenCalled();
    expect(sweep.modelCalls.total).toBe(0);
    expect(sweep.reusedTexts).toBe(3);
    // No slot was needed, so the ceiling of one run did not stop it from staying on the real engine.
    expect(sweep.engine).toBe("muse-spark-1.3");
    expect(sweep.fellBackReason).toBeNull();
    expect(sweep.briefing.source).toBe("model");
  });

  it("writes again the next day, and when the facts changed", async () => {
    const store = memoryStore();
    const cases = [openCase("1004", { deadlineHours: 17 })];
    const first = fakeProvider();
    await runSweep({ ...base, provider: first.provider, cases, store });

    const changed = fakeProvider();
    await runSweep({ ...base, provider: changed.provider, cases: [...cases, openCase("1005", { deadlineHours: 30 })], store });
    expect(changed.chat).toHaveBeenCalledTimes(1);

    const tomorrow = fakeProvider();
    const next = new Date(SWEEP_NOW.getTime() + 25 * 3_600_000);
    await runSweep({ ...base, now: next, provider: tomorrow.provider, cases, store });
    expect(tomorrow.chat).toHaveBeenCalledTimes(1);
  });

  it("shares one run between two requests that arrive together", async () => {
    const { provider, chat } = fakeProvider({ delayMs: 20 });
    const store = memoryStore();
    const opts = { ...base, provider, cases: [openCase("1004", { deadlineHours: 17 })], store };
    const [a, b] = await Promise.all([runSweepOnce(opts), runSweepOnce(opts)]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(store.saved).toHaveLength(1);
  });
});

describe("what happens when the model's text cannot be used", () => {
  it("replaces a briefing that states a figure the code did not give with the template, and says so", async () => {
    const { provider } = fakeProvider({ briefing: "Claim 999.99 EUR before Friday 13 Nov." });
    const { sweep } = await runSweep({ ...base, provider, cases: [openCase("1004", { deadlineHours: 17, eur: 25 })], store: memoryStore() });
    expect(sweep.briefing.source).toBe("template");
    expect(sweep.briefing.note).toMatch(/figure the code did not give/);
    expect(sweep.briefing.text).not.toMatch(/999/);
    expect(sweep.modelCalls.briefing).toBe(1);
  });

  it("falls back to the template when the call fails, without losing the rest of the sweep", async () => {
    const { provider } = fakeProvider({ briefing: new Error("boom"), nudge: Object.assign(new Error("rate limited"), { status: 429 }) });
    const { sweep, stored } = await runSweep({ ...base, provider, cases: [openCase("1004", { deadlineHours: 17 }), ...waiters(1)], store: memoryStore() });
    expect(stored).toBe(true);
    expect(sweep.briefing).toMatchObject({ source: "template", note: expect.stringMatching(/call failed/) });
    expect(sweep.items[1].nudge).toMatchObject({ source: "template" });
    expect(sweep.items.map((i) => i.caseId)).toEqual(["1004", "w0"]);
  });

  it("refuses a nudge that promises a refund", async () => {
    const { provider } = fakeProvider({ nudge: "Hello, we will refund you as soon as you reply." });
    const { sweep } = await runSweep({ ...base, provider, cases: waiters(1), store: memoryStore() });
    expect(sweep.items[0].nudge).toMatchObject({ source: "template", note: expect.stringMatching(/money or a promise/) });
  });

  it("does not cache a template as if it were the model's", async () => {
    const store = memoryStore();
    const cases = [openCase("1004", { deadlineHours: 17 })];
    const bad = fakeProvider({ briefing: new Error("down") });
    await runSweep({ ...base, provider: bad.provider, cases, store });
    const good = fakeProvider();
    const { sweep } = await runSweep({ ...base, provider: good.provider, cases, store });
    expect(good.chat).toHaveBeenCalledTimes(1);
    expect(sweep.briefing.source).toBe("model");
  });
});

describe("DEMO MODE (no key)", () => {
  it("writes with the labelled script, calls nothing and takes no slot", async () => {
    const { sweep } = await runSweep({ ...base, env: { DAMAGE_DESK_REAL_RUNS_PER_DAY: "0" }, cases: [openCase("1004", { deadlineHours: 17, eur: 25 }), ...waiters(2)], store: memoryStore() });
    expect(sweep.engine).toBe("demo-mock");
    expect(sweep.fellBackReason).toBe("no_credentials");
    expect(sweep.engineDetail.label).toMatch(/DEMO MODE, not Muse/);
    expect(sweep.briefing.source).toBe("demo-mock");
    expect(sweep.items[1].nudge?.source).toBe("demo-mock");
    expect(sweep.modelCalls).toEqual({ briefing: 0, nudges: 0, total: 0, cap: 6 });
    expect(sweep.usage).toBeNull();
    // The plan is the same as with a real engine.
    expect(sweep.items.map((i) => i.caseId)).toEqual(["1004", "w0", "w1"]);
  });

  it("writes the nudge in the customer's language when a template exists, and says when it does not", async () => {
    const de = waitingCase("de1", 70, { language: "de" });
    const { sweep } = await runSweep({ ...base, cases: [waitingCase("fr1", 70, { language: "fr", deadlineHours: 50 }), de], store: memoryStore() });
    const byId = Object.fromEntries(sweep.items.map((i) => [i.caseId, i.nudge]));
    expect(byId.fr1?.text).toMatch(/^Bonjour,/);
    expect(byId.de1?.text).toMatch(/^Hello,/);
    expect(byId.de1?.note).toMatch(/written in English/);
  });

  it("never reads a key from the environment it was given when none is set", async () => {
    const { sweep } = await runSweep({ ...base, env: { MODEL_API_KEY: "" }, cases: [openCase("1004", { deadlineHours: 17 })], store: memoryStore() });
    expect(sweep.engine).toBe("demo-mock");
  });
});

describe("a case run privately", () => {
  it("gets a template nudge and is kept out of what the Meta Model API receives", async () => {
    const priv = waitingCase("PRIV-9", 70);
    priv.engine = "open-weights";
    priv.assessment = { ...priv.assessment!, item: "Private lamp" };
    const { provider, chat } = fakeProvider();
    const { sweep } = await runSweep({ ...base, provider, cases: [openCase("1004", { deadlineHours: 17 }), priv], store: memoryStore() });
    const item = sweep.items.find((i) => i.caseId === "PRIV-9");
    expect(item?.nudge).toMatchObject({ source: "template", note: expect.stringMatching(/ran privately/) });
    // Only the briefing went out, and without the private case's order number or item.
    expect(chat).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(chat.mock.calls)).not.toMatch(/PRIV-9|Private lamp/);
    // A private nudge does not use up one of the five.
    expect(sweep.nudgesOverCap).toBe(0);
  });
});

describe("storing the result", () => {
  it("stores the sweep it returns, with the day it is cached for (Paris time)", async () => {
    const store = memoryStore();
    const { sweep } = await runSweep({ ...base, trigger: "cron", cases: [openCase("1004", { deadlineHours: 17 })], store });
    expect(store.saved).toEqual([sweep]);
    expect(sweep).toMatchObject({ version: 1, trigger: "cron", day: "2026-10-28", generatedAt: SWEEP_NOW.toISOString() });
  });

  it("returns the sweep with stored=false when the store fails", async () => {
    const store: SweepStore = { load: async () => null, save: async () => Promise.reject(new Error("disk full")) };
    const { sweep, stored } = await runSweep({ ...base, cases: [openCase("1004", { deadlineHours: 17 })], store });
    expect(stored).toBe(false);
    expect(sweep.items).toHaveLength(1);
  });

  it("carries on when the previous sweep cannot be read", async () => {
    const store: SweepStore = { load: async () => Promise.reject(new Error("EACCES")), save: async () => {} };
    const { sweep } = await runSweep({ ...base, cases: [openCase("1004", { deadlineHours: 17 })], store });
    expect(sweep.items).toHaveLength(1);
  });

  it("holds no customer name, e-mail, address or message anywhere", async () => {
    const { provider } = fakeProvider();
    const { sweep } = await runSweep({ ...base, provider, cases: [openCase("1001", { deadlineHours: 10 }), ...waiters(2)], store: memoryStore() });
    expect(JSON.stringify(sweep)).not.toMatch(/camille|laurent|example\.com|Lyon|arrived broken/i);
  });
});

describe("the recorded runs", () => {
  it("are not read unless asked for", async () => {
    const recorded: CaseRecord = { ...openCase("rec", { deadlineHours: -20 }), recorded: { recordedOn: "2026-10-27" }, createdAt: "2026-10-27T16:00:00.000Z" };
    const off = await runSweep({ ...base, cases: [recorded], store: memoryStore() });
    expect(off.sweep.items).toHaveLength(0);
    const on = await runSweep({ ...base, includeRecorded: true, cases: [recorded], store: memoryStore() });
    expect(on.sweep.includeRecorded).toBe(true);
    expect(on.sweep.items).toHaveLength(1);
  });
});
