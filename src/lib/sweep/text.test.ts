import { describe, expect, it } from "vitest";
import { buildSweepPlan } from "./plan";
import { SWEEP_NOW, openCase, waitingCase } from "./plan-helpers";
import {
  BRIEFING_FACT_ITEMS,
  BRIEFING_MAX_CHARS,
  NUDGE_MAX_CHARS,
  acceptModelText,
  briefingFacts,
  inputKey,
  nudgeFacts,
  templateBriefing,
  templateNudge,
} from "./text";

describe("acceptModelText: the fence around what a model writes", () => {
  const facts = JSON.stringify({ today: "Wed 28 Oct", top: [{ rank: 1, hoursLeft: 17, amountEur: 52.9, deadline: "Thu 29 Oct, 11:35" }] });

  it("accepts a paragraph whose every number is in the facts", () => {
    const ok = acceptModelText("Start with item 1: it closes Thu 29 Oct, 11:35, in 17 hours, for 52.90 EUR.", facts, "briefing");
    expect(ok).toEqual({ ok: true, text: "Start with item 1: it closes Thu 29 Oct, 11:35, in 17 hours, for 52.90 EUR." });
  });

  it("refuses a figure the code did not give (an amount, an hour count, a date)", () => {
    for (const text of [
      "Claim 99.00 EUR today.",
      "It closes in 18 hours.",
      "The deadline is 30 Oct.",
      "About 52.91 EUR is at stake.",
    ]) {
      expect(acceptModelText(text, facts, "briefing"), text).toEqual({ ok: false, reason: "figure_not_in_facts" });
    }
  });

  it("refuses an empty, a too long, or a linking text", () => {
    expect(acceptModelText("   ", facts, "briefing")).toEqual({ ok: false, reason: "empty" });
    expect(acceptModelText(null, facts, "nudge")).toEqual({ ok: false, reason: "empty" });
    expect(acceptModelText("x".repeat(BRIEFING_MAX_CHARS + 1), facts, "briefing")).toEqual({ ok: false, reason: "too_long" });
    expect(acceptModelText("x".repeat(NUDGE_MAX_CHARS + 1), facts, "nudge")).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses a link or an address", () => {
    for (const text of ["See https://example.com/claim", "Write to claims@carrier.example", "Go to www.carrier.example"]) {
      expect(acceptModelText(text, facts, "briefing"), text).toEqual({ ok: false, reason: "link_or_address" });
    }
  });

  it("refuses a nudge that talks about money or promises a replacement, in English and French", () => {
    for (const text of [
      "We will refund you soon.",
      "Your replacement ships tomorrow.",
      "You will get 20 € back.",
      "Nous vous enverrons un remplacement.",
      "Votre remboursement arrive.",
    ]) {
      const refused = acceptModelText(text, "{}", "nudge");
      expect(refused.ok, text).toBe(false);
    }
    expect(acceptModelText("Hello,\n\nWe are still waiting for sharper photos so we can move forward. Thank you!", "{}", "nudge")).toMatchObject({ ok: true });
  });

  it("cleans fences, bold and quotes, and joins a briefing into one paragraph", () => {
    const out = acceptModelText('```\n"**Start** with item 1.\nThen wait."\n```', facts, "briefing");
    expect(out).toEqual({ ok: true, text: "Start with item 1. Then wait." });
  });

  it("keeps the paragraphs of a nudge", () => {
    const out = acceptModelText("Hello,\n\nStill waiting for the photos.\n\nThank you!", "{}", "nudge");
    expect(out).toMatchObject({ ok: true });
    expect(out.ok && out.text).toContain("\n\n");
  });
});

describe("what the model is given", () => {
  it("holds the order of the plan and the code's figures, and no customer data", () => {
    const plan = buildSweepPlan([openCase("1001", { deadlineHours: 17, eur: 52.9 }), waitingCase("1002", 70, { language: "fr" })], SWEEP_NOW);
    const text = briefingFacts(plan, SWEEP_NOW) + nudgeFacts(plan.items[1]);
    expect(text).toContain("52.9");
    expect(text).toContain("Thu 29 Oct");
    expect(text).not.toMatch(/camille|laurent|example\.com|Lyon|arrived broken|6A99001001001/i);
  });

  it("gives the briefing at most the top of the plan", () => {
    const many = Array.from({ length: 12 }, (_, i) => openCase(`c${i}`, { deadlineHours: 10 + i }));
    const facts = JSON.parse(briefingFacts(buildSweepPlan(many, SWEEP_NOW), SWEEP_NOW)) as { top: unknown[]; counts: { due: number } };
    expect(facts.top).toHaveLength(BRIEFING_FACT_ITEMS);
    expect(facts.counts.due).toBe(12);
  });

  it("leaves the order and the item of a privately run case out of the briefing", () => {
    const priv = openCase("PRIVATE-77", { deadlineHours: 10 });
    priv.engine = "open-weights";
    const facts = briefingFacts(buildSweepPlan([priv], SWEEP_NOW), SWEEP_NOW);
    expect(facts).not.toMatch(/PRIVATE-77|Ceramic vase/);
  });

  it("states what a nudge is about from what the code knows, in the customer's language", () => {
    const [item] = buildSweepPlan([waitingCase("1002", 70, { language: "fr" })], SWEEP_NOW).items;
    expect(JSON.parse(nudgeFacts(item))).toEqual({ language: "French", order: "#1002", item: "Ceramic vase", stillNeeded: ["sharper photos of the damage"] });
  });

  it("keys a text by engine, kind and facts", () => {
    const a = inputKey("muse-spark-1.3", "briefing", "{}");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(inputKey("muse-spark-1.3", "briefing", "{}")).toBe(a);
    expect(inputKey("demo-mock", "briefing", "{}")).not.toBe(a);
    expect(inputKey("muse-spark-1.3", "nudge", "{}")).not.toBe(a);
    expect(inputKey("muse-spark-1.3", "briefing", '{"a":1}')).not.toBe(a);
  });
});

describe("templates", () => {
  it("writes a briefing from the plan with the plan's own figures", () => {
    const plan = buildSweepPlan([openCase("1004", { deadlineHours: 17, eur: 25, carrier: "mondial_relay" }), waitingCase("1003", 60)], SWEEP_NOW);
    const text = templateBriefing(plan, SWEEP_NOW);
    expect(text).toContain("Wed 28 Oct");
    expect(text).toContain("Mondial Relay (Offre Start), #1004");
    expect(text).toContain("17 h");
    expect(text).toContain("25.00 EUR");
    expect(text).toMatch(/1 customer has not answered/);
  });

  it("says plainly when nothing is due", () => {
    expect(templateBriefing(buildSweepPlan([], SWEEP_NOW), SWEEP_NOW)).toMatch(/Nothing is due/);
  });

  it("writes a nudge in English or French, and falls back to English for another language", () => {
    const [fr] = buildSweepPlan([waitingCase("1002", 70, { language: "fr" })], SWEEP_NOW).items;
    expect(templateNudge(fr)).toMatchObject({ language: "fr" });
    expect(templateNudge(fr).text).toMatch(/^Bonjour,/);
    const [de] = buildSweepPlan([waitingCase("1003", 70, { language: "de" })], SWEEP_NOW).items;
    expect(templateNudge(de)).toMatchObject({ language: "en" });
    expect(templateNudge(de).text).toMatch(/^Hello,/);
  });

  it("never promises money or a replacement", () => {
    const [item] = buildSweepPlan([waitingCase("1002", 70)], SWEEP_NOW).items;
    expect(acceptModelText(templateNudge(item).text, nudgeFacts(item), "nudge")).toMatchObject({ ok: true });
  });
});
