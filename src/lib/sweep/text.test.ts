import { describe, expect, it } from "vitest";
import { formatMoment } from "./format";
import { buildSweepPlan } from "./plan";
import { SWEEP_NOW, openCase, waitingCase } from "./plan-helpers";
import {
  BRIEFING_FACT_ITEMS,
  BRIEFING_MAX_CHARS,
  NUDGE_MAX_CHARS,
  acceptModelText,
  briefingInput,
  inputKey,
  mentionsMoneyOrPromise,
  modelMayWriteNudge,
  nudgeInput,
  templateBriefing,
  templateNudge,
} from "./text";

// The probe of the review of 29 Oct 2026: the real facts of two cases, #1004 (25 EUR in 17 h) and
// #1005 (250 EUR in 31 h). Every sentence below was ACCEPTED by the first fence, which only asked
// that each number appear somewhere in the facts.
const probePlan = () =>
  buildSweepPlan(
    [
      openCase("1004", { deadlineHours: 17, eur: 25, carrier: "mondial_relay" }),
      openCase("1005", { deadlineHours: 31, eur: 250, carrier: "colissimo" }),
    ],
    SWEEP_NOW,
  );

describe("acceptModelText: the model writes placeholders, the code writes the figures", () => {
  const { values } = briefingInput(probePlan());

  it("fills the placeholders with the code's own strings, each for its own case", () => {
    const ok = acceptModelText(
      "File {order:1} first: it closes {deadline:1} and up to {amount:1} is at stake. Then {order:2}, closing {deadline:2}, up to {amount:2}.",
      "briefing",
      values,
    );
    expect(ok).toEqual({
      ok: true,
      text: "File #1004 first: it closes Thu 29 Oct, 04:00 and up to 25.00 EUR is at stake. Then #1005, closing Thu 29 Oct, 18:00, up to 250.00 EUR.",
    });
  });

  it("refuses the probe sentences that the first fence accepted (wrong pairing, spelled-out numbers, a promise)", () => {
    for (const text of [
      "File #1004 first: up to 250 EUR, and it closes in 2 days.",
      "File {order:1} first, it closes in two days.",
      "closes in three days and is worth twenty-five euros",
      "The carrier will pay 25 EUR.",
      "File {order:1} first: the carrier will pay {amount:1}.",
      "File {order:1} first, it is worth one hundred and twenty euros.",
    ]) {
      expect(acceptModelText(text, "briefing", values).ok, text).toBe(false);
    }
  });

  it("refuses any digit outside a placeholder, in any script", () => {
    for (const text of ["File 1004 first.", "File {order:1} first, it is item 1.", "Il reste ٣ jours.", "Take ½ of it.", "Step ①: file."]) {
      expect(acceptModelText(text, "briefing", values), text).toEqual({ ok: false, reason: "own_figure" });
    }
  });

  it("refuses number words, units of time, currencies and relative dates", () => {
    for (const text of [
      "It closes in twenty hours.",
      "File {order:1} before the end of the week.",
      "Claim it today or tomorrow.",
      "It is worth a hundred dollars.",
      "It is worth a few euros.",
      "File it tonight.",
      "That is 5% of the stock.",
      "One case closes first, so file {order:1}.",
      "Il vous reste trois jours.",
    ]) {
      expect(acceptModelText(text, "briefing", values), text).toEqual({ ok: false, reason: "own_figure" });
    }
  });

  it("does not refuse a plain use of 'one' or an ordinal", () => {
    const ok = acceptModelText("Start with the first one, {order:1}: no one else is as close to its deadline.", "briefing", values);
    expect(ok).toMatchObject({ ok: true });
  });

  it("refuses a placeholder the code did not offer, or a stray brace", () => {
    for (const text of ["File {order:9} first.", "File {amount:3}.", "Total {total}.", "File {order:1 first.", "{}"]) {
      expect(acceptModelText(text, "briefing", values), text).toEqual({ ok: false, reason: "unknown_placeholder" });
    }
  });

  it("refuses a deadline or an amount that does not follow its own order", () => {
    for (const text of [
      "File {order:1}: up to {amount:2}.",
      "File {order:1} and {order:2}, closing {deadline:1}.",
      "Up to {amount:1} is at stake.",
    ]) {
      expect(acceptModelText(text, "briefing", values), text).toEqual({ ok: false, reason: "misplaced_placeholder" });
    }
  });

  it("refuses a briefing that promises a carrier outcome", () => {
    for (const text of [
      "File {order:1}: the carrier will refund you.",
      "We guarantee a payout for {order:1}.",
      "You are entitled to compensation on {order:1}.",
      "{order:1} will be paid soon.",
    ]) {
      expect(acceptModelText(text, "briefing", values), text).toEqual({ ok: false, reason: "promise_or_amount" });
    }
  });

  it("refuses an empty, a too long, or a linking text", () => {
    expect(acceptModelText("   ", "briefing", values)).toEqual({ ok: false, reason: "empty" });
    expect(acceptModelText(null, "nudge", values)).toEqual({ ok: false, reason: "empty" });
    expect(acceptModelText("x".repeat(BRIEFING_MAX_CHARS + 1), "briefing", values)).toEqual({ ok: false, reason: "too_long" });
    expect(acceptModelText("x".repeat(NUDGE_MAX_CHARS + 1), "nudge", values)).toEqual({ ok: false, reason: "too_long" });
    for (const text of ["See https://example.com/claim", "Write to claims@carrier.example", "Go to www.carrier.example"]) {
      expect(acceptModelText(text, "briefing", values), text).toEqual({ ok: false, reason: "link_or_address" });
    }
  });

  it("cleans fences, bold and quotes, and joins a briefing into one paragraph", () => {
    const out = acceptModelText('```\n"**Start** with {order:1}.\nThen wait."\n```', "briefing", values);
    expect(out).toEqual({ ok: true, text: "Start with #1004. Then wait." });
  });
});

describe("acceptModelText for a nudge", () => {
  const { values } = nudgeInput(buildSweepPlan([waitingCase("1002", 70)], SWEEP_NOW).items[0]);

  it("fills {order} and {item}, and keeps the paragraphs", () => {
    const out = acceptModelText("Hello,\n\nWe are still waiting for sharper photos for {order} ({item}).\n\nThank you!", "nudge", values);
    expect(out).toEqual({
      ok: true,
      text: "Hello,\n\nWe are still waiting for sharper photos for #1002 (Ceramic vase).\n\nThank you!",
    });
  });

  it("refuses a deadline, a threat, a figure or a number word, whatever the language of the words around it", () => {
    for (const text of [
      "Please reply within three days or we cannot help.",
      "Please reply within 3 days.",
      "Merci de répondre sous trois jours, sinon nous ne pourrons pas continuer.",
      "Merci de répondre dans les 48 heures.",
      "This is your last chance to answer.",
      "Please answer by the deadline, otherwise we stop.",
      "Please answer this week.",
      "Hello, send photos of order 1002.",
    ]) {
      expect(acceptModelText(text, "nudge", values).ok, text).toBe(false);
    }
  });

  it("refuses money, a replacement, a guarantee or a promise, in English and French", () => {
    for (const text of [
      "We will refund you soon.",
      "Your replacement ships tomorrow.",
      "You will get 20 € back.",
      "Nous vous enverrons un remplacement.",
      "Votre remboursement arrive.",
      "We guarantee a solution.",
      "Nous vous garantissons une solution.",
      "We will pay for it.",
    ]) {
      expect(acceptModelText(text, "nudge", values).ok, text).toBe(false);
    }
    expect(acceptModelText("Hello,\n\nWe are still waiting for sharper photos so we can move forward. Thank you!", "nudge", values)).toMatchObject({ ok: true });
  });

  it("is asked of the model only in English and French, the two languages the fence can read", () => {
    const item = (language: string) => buildSweepPlan([waitingCase("1002", 70, { language })], SWEEP_NOW).items[0];
    expect(modelMayWriteNudge(item("en"))).toBe(true);
    expect(modelMayWriteNudge(item("fr"))).toBe(true);
    // A refund promise in German ("danach erhalten Sie eine Rückerstattung") would pass a word list of
    // English and French: the model is never asked for a German nudge, a template is used instead.
    for (const language of ["de", "es", "it", "pt", "nl"]) expect(modelMayWriteNudge(item(language)), language).toBe(false);
  });
});

describe("what the model is given", () => {
  it("holds no figure at all: positions in words, placeholder names, and no count or total", () => {
    const { facts, values } = briefingInput(probePlan());
    const withoutPlaceholders = facts.replace(/\{[a-z]+:\d+\}/g, "");
    expect(withoutPlaceholders).not.toMatch(/\d/);
    expect(facts).not.toMatch(/25|250|1004|1005|Thu 29 Oct|counts|claimableUpToEur|hoursLeft|waitingHours/);
    const parsed = JSON.parse(facts) as { top: { position: string; fill: string[]; carrier: string }[] };
    expect(parsed.top.map((t) => t.position)).toEqual(["first", "second"]);
    expect(parsed.top[0].fill).toEqual(["{order:1}", "{item:1}", "{deadline:1}", "{amount:1}"]);
    expect(values).toMatchObject({ "order:1": "#1004", "deadline:1": "Thu 29 Oct, 04:00", "amount:1": "25.00 EUR", "amount:2": "250.00 EUR" });
  });

  it("holds no customer data", () => {
    const plan = buildSweepPlan([openCase("1001", { deadlineHours: 17, eur: 52.9 }), waitingCase("1002", 70, { language: "fr" })], SWEEP_NOW);
    const text = JSON.stringify([briefingInput(plan), nudgeInput(plan.items[1])]);
    expect(text).not.toMatch(/camille|laurent|example\.com|Lyon|arrived broken|6A99001001001/i);
  });

  it("gives the briefing at most the top of the plan", () => {
    const many = Array.from({ length: 12 }, (_, i) => openCase(`c${i}`, { deadlineHours: 10 + i }));
    const facts = JSON.parse(briefingInput(buildSweepPlan(many, SWEEP_NOW)).facts) as { top: unknown[]; moreCasesNotListed: boolean };
    expect(facts.top).toHaveLength(BRIEFING_FACT_ITEMS);
    expect(facts.moreCasesNotListed).toBe(true);
  });

  it("sends nothing about a case run privately but the position it sits at", () => {
    const priv = openCase("PRIVATE-77", { deadlineHours: 10, eur: 777.7, carrier: "mondial_relay" });
    priv.engine = "open-weights";
    const live = openCase("1004", { deadlineHours: 17, eur: 25, carrier: "colissimo" });
    const plan = buildSweepPlan([priv, live], SWEEP_NOW);
    expect(plan.items.map((i) => i.caseId)).toEqual(["PRIVATE-77", "1004"]);
    const { facts, values } = briefingInput(plan);
    expect(formatMoment(plan.items[0].deadline!.at)).toBe("Wed 28 Oct, 21:00");
    // None of its order, carrier, deadline (Wed 28 Oct, 21:00) or amount; its entry holds no other key.
    expect(facts + JSON.stringify(values)).not.toMatch(/PRIVATE-77|777|Mondial|Wed 28 Oct, 21:00/);
    expect(JSON.parse(facts).top[0]).toEqual({ position: "first", private: true });
    // ... and no count or total from which it could be worked out by subtraction.
    expect(facts).not.toMatch(/counts|claimableUpToEur|due|closingSoon/);
    expect(Object.keys(values).every((k) => k.endsWith(":2"))).toBe(true);
    // The live case next to it is described as usual.
    expect(values["order:2"]).toBe("#1004");
  });

  it("marks an item of a rehearsal on a recorded run, so that its dates are not read as today's", () => {
    const recorded = { ...openCase("rec", { deadlineHours: 5 }), recorded: { recordedOn: "2026-10-27" }, createdAt: "2026-10-27T16:00:00.000Z" };
    const facts = briefingInput(buildSweepPlan([recorded], SWEEP_NOW, { includeRecorded: true })).facts;
    expect(JSON.parse(facts).top[0].recorded).toBe(true);
  });

  it("states what a nudge is about from what the code knows, in the customer's language", () => {
    const [item] = buildSweepPlan([waitingCase("1002", 70, { language: "fr" })], SWEEP_NOW).items;
    const input = nudgeInput(item);
    expect(JSON.parse(input.facts)).toEqual({ language: "French", stillNeeded: ["sharper photos of the damage"], fill: ["{order}", "{item}"] });
    expect(input.values).toEqual({ order: "#1002", item: "Ceramic vase" });
  });

  it("keys a text by engine, kind, facts and figures", () => {
    const input = { facts: "{}", values: {} };
    const a = inputKey("muse-spark-1.3", "briefing", input);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(inputKey("muse-spark-1.3", "briefing", input)).toBe(a);
    expect(inputKey("demo-mock", "briefing", input)).not.toBe(a);
    expect(inputKey("muse-spark-1.3", "nudge", input)).not.toBe(a);
    expect(inputKey("muse-spark-1.3", "briefing", { ...input, facts: '{"a":1}' })).not.toBe(a);
    // The figures are part of the key: a changed amount is a new text, not today's old one.
    expect(inputKey("muse-spark-1.3", "briefing", { ...input, values: { "amount:1": "25.00 EUR" } })).not.toBe(a);
  });

  it("keeps the same key as the hours go by, and changes it when the plan does", () => {
    const cases = [openCase("1004", { deadlineHours: 17, eur: 25 }), waitingCase("1003", 60)];
    const key = (now: Date, list = cases) => inputKey("muse-spark-1.3", "briefing", briefingInput(buildSweepPlan(list, now)));
    const later = new Date(SWEEP_NOW.getTime() + 3.5 * 3_600_000);
    expect(key(later)).toBe(key(SWEEP_NOW));
    expect(key(SWEEP_NOW, [openCase("1004", { deadlineHours: 17, eur: 26 }), cases[1]])).not.toBe(key(SWEEP_NOW));
    expect(key(SWEEP_NOW, [...cases, openCase("1005", { deadlineHours: 30 })])).not.toBe(key(SWEEP_NOW));
  });
});

describe("templates", () => {
  it("writes a briefing from the plan with the plan's own figures, as absolute moments", () => {
    const plan = buildSweepPlan([openCase("1004", { deadlineHours: 17, eur: 25, carrier: "mondial_relay" }), waitingCase("1003", 60)], SWEEP_NOW);
    const text = templateBriefing(plan, SWEEP_NOW);
    expect(text).toContain("Wed 28 Oct");
    expect(text).toContain("Mondial Relay (Offre Start), #1004");
    expect(text).toContain("claim deadline closes Thu 29 Oct, 04:00");
    expect(text).not.toMatch(/in 17 h/);
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

  it("never promises money, a replacement or a deadline", () => {
    for (const language of ["en", "fr", "de"]) {
      const [item] = buildSweepPlan([waitingCase("1002", 70, { language })], SWEEP_NOW).items;
      expect(mentionsMoneyOrPromise(templateNudge(item).text, "nudge"), language).toBe(false);
    }
  });
});
