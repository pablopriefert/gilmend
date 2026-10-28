import { describe, expect, it } from "vitest";
import { makeCase } from "@/components/fixtures";
import type { CaseRecord } from "../types";
import { MAX_LISTED_ITEMS, SWEEP_HORIZON_HOURS, SWEEP_WAITING_HOURS, buildSweepPlan, sweepSettings } from "./plan";
import { SWEEP_NOW, at, claimOf, openCase, waitingCase } from "./plan-helpers";

const ids = (cases: CaseRecord[], options = {}) => buildSweepPlan(cases, SWEEP_NOW, options).items.map((i) => i.caseId);

describe("ranking: deadline first, money second", () => {
  it("puts the soonest deadline first, whatever the money", () => {
    const cases = [
      openCase("rich", { deadlineHours: 60, eur: 250 }),
      openCase("urgent", { deadlineHours: 12, eur: 9 }),
      openCase("middle", { deadlineHours: 30, eur: 100 }),
    ];
    expect(ids(cases)).toEqual(["urgent", "middle", "rich"]);
  });

  it("breaks a tie on the deadline with the money, most first", () => {
    const cases = [
      openCase("small", { deadlineHours: 20, eur: 25 }),
      openCase("big", { deadlineHours: 20, eur: 250 }),
      openCase("mid", { deadlineHours: 20, eur: 52.9 }),
    ];
    expect(ids(cases)).toEqual(["big", "mid", "small"]);
  });

  it("lists a case with no deadline after every case that has one, then by money", () => {
    const cases = [
      openCase("none-rich", { deadlineHours: null, eur: 500 }),
      openCase("late", { deadlineHours: 300, eur: 1 }),
      openCase("none-poor", { deadlineHours: null, eur: 5 }),
    ];
    expect(ids(cases)).toEqual(["late", "none-rich", "none-poor"]);
  });

  it("is a pure function of the cases and the clock: the input order changes nothing", () => {
    const cases = [
      openCase("a", { deadlineHours: 30, eur: 40 }),
      openCase("b", { deadlineHours: 30, eur: 40 }),
      openCase("c", { deadlineHours: 5, eur: 10 }),
      waitingCase("d", 60),
      openCase("e", { deadlineHours: null, eur: 0 }),
    ];
    const forward = buildSweepPlan(cases, SWEEP_NOW);
    const backward = buildSweepPlan([...cases].reverse(), SWEEP_NOW);
    expect(backward).toEqual(forward);
    // Equal cases keep a fixed order (by id), so two sweeps never swap them.
    expect(forward.items.map((i) => i.caseId).slice(0, 3)).toEqual(["c", "a", "b"]);
    expect(forward.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("uses the stored claim deadline of computeClaim, not a date of its own", () => {
    const [item] = buildSweepPlan([openCase("x", { deadlineHours: 17 })], SWEEP_NOW).items;
    expect(item.deadline?.kind).toBe("claim");
    expect(item.deadline?.at).toBe(at(17));
    expect(item.deadline?.hoursLeft).toBeCloseTo(17, 5);
  });
});

describe("deadline windows", () => {
  it("flags a deadline inside 72 h and leaves one beyond it as a plain ranked date", () => {
    const plan = buildSweepPlan(
      [openCase("in", { deadlineHours: SWEEP_HORIZON_HOURS - 1 }), openCase("out", { deadlineHours: SWEEP_HORIZON_HOURS + 1 })],
      SWEEP_NOW,
    );
    const [inside, outside] = plan.items;
    expect(inside.caseId).toBe("in");
    expect(inside.withinHorizon).toBe(true);
    expect(inside.reasons.map((r) => r.kind)).toContain("claim_deadline");
    expect(outside.withinHorizon).toBe(false);
    expect(outside.reasons.map((r) => r.kind)).not.toContain("claim_deadline");
    expect(outside.deadline).not.toBeNull();
    expect(plan.counts.closingSoon).toBe(1);
  });

  it("counts a deadline exactly 72 h away as inside the window", () => {
    expect(buildSweepPlan([openCase("edge", { deadlineHours: 72 })], SWEEP_NOW).items[0].withinHorizon).toBe(true);
  });

  it("does not treat a deadline that already passed as one (the money is gone, not due)", () => {
    const [item] = buildSweepPlan([openCase("late", { deadlineHours: -5 })], SWEEP_NOW).items;
    expect(item.deadline).toBeNull();
    expect(item.withinHorizon).toBe(false);
    // An expired claim holds no money any more.
    expect(item.amountEur).toBe(0);
  });

  it("adds the reserve window when it closes at another moment than the claim (Colissimo)", () => {
    const base = openCase("colis", { deadlineHours: 4000, carrier: "colissimo" });
    const c = { ...base, claim: claimOf({ claimDeadline: at(4000), reserveDeadline: at(20) }) };
    const [item] = buildSweepPlan([c], SWEEP_NOW).items;
    expect(item.deadline?.kind).toBe("reserve");
    expect(item.deadline?.binding).toBe(false);
    const reserve = item.reasons.find((r) => r.kind === "reserve_window");
    expect(reserve?.text).toMatch(/prudential/);
    expect(item.withinHorizon).toBe(true);
  });

  it("shows one deadline, not two, when the reserve window and the claim close together (Mondial Relay)", () => {
    const base = openCase("mr", { deadlineHours: 20, carrier: "mondial_relay" });
    const c = { ...base, claim: claimOf({ claimDeadline: at(20), reserveDeadline: at(20) }) };
    const [item] = buildSweepPlan([c], SWEEP_NOW).items;
    expect(item.reasons.filter((r) => r.kind === "claim_deadline" || r.kind === "reserve_window")).toHaveLength(1);
  });

  it("ignores the deadline of a claim the agent decided not to make, but keeps one that is only waiting for evidence", () => {
    const declined = openCase("declined", { deadlineHours: 10 });
    declined.decision = { ...declined.decision!, carrierClaim: false };
    expect(buildSweepPlan([declined], SWEEP_NOW).items[0].deadline).toBeNull();
    // A blurry-photo claim keeps its deadline: the clock runs while the customer answers.
    const early = buildSweepPlan([waitingCase("w", 10, { deadlineHours: 30 })], SWEEP_NOW).items[0];
    expect(early.reasons.map((r) => r.kind)).toEqual(["claim_deadline"]);
    const waiting = buildSweepPlan([waitingCase("w2", 60, { deadlineHours: 30 })], SWEEP_NOW).items[0];
    expect(waiting.deadline?.at).toBe(at(30));
  });
});

describe("waiting for the customer", () => {
  it("flags an approved request with no reply once the wait reaches the threshold", () => {
    const below = buildSweepPlan([waitingCase("w", SWEEP_WAITING_HOURS - 1)], SWEEP_NOW);
    expect(below.items).toHaveLength(0);
    const above = buildSweepPlan([waitingCase("w", SWEEP_WAITING_HOURS + 1)], SWEEP_NOW);
    const [item] = above.items;
    expect(item.action).toBe("nudge_customer");
    expect(item.waiting?.hours).toBeCloseTo(SWEEP_WAITING_HOURS + 1, 5);
    expect(item.waiting?.missing).toEqual(["photos"]);
    expect(above.counts.waitingOnCustomer).toBe(1);
  });

  it("counts the wait from the merchant's approval, not from the report", () => {
    const c = waitingCase("w", 10);
    c.createdAt = at(-200);
    c.report = { ...c.report, receivedAt: at(-200) };
    expect(buildSweepPlan([c], SWEEP_NOW).items).toHaveLength(0);
  });

  it("does not call a case 'waiting' while the request is still waiting for the merchant's click", () => {
    const c = { ...waitingCase("w", 100), status: "needs_review" as const };
    const [item] = buildSweepPlan([c], SWEEP_NOW).items;
    expect(item.waiting).toBeNull();
    expect(item.reasons.map((r) => r.kind)).toEqual(["awaiting_click"]);
    expect(item.action).toBe("review_case");
  });

  it("stops waiting once the customer's reply was added (a new round decides again)", () => {
    const c = waitingCase("w", 100);
    c.followUps = [{ id: "f1", receivedAt: at(-1), message: "Here is a sharper photo.", photos: [] }];
    c.decision = { ...c.decision!, decision: "reship", carrierClaim: true };
    c.status = "needs_review";
    const reasons = buildSweepPlan([c], SWEEP_NOW).items[0].reasons.map((r) => r.kind);
    expect(reasons).not.toContain("waiting_on_customer");
  });

  it("takes the threshold from the environment when it is a sensible number", () => {
    expect(sweepSettings({ DAMAGE_DESK_SWEEP_WAITING_HOURS: "24" }).waitingHours).toBe(24);
    for (const bad of ["", "0", "-5", "abc", "100000"]) {
      expect(sweepSettings({ DAMAGE_DESK_SWEEP_WAITING_HOURS: bad }).waitingHours).toBe(SWEEP_WAITING_HOURS);
    }
    const c = waitingCase("w", 30);
    expect(buildSweepPlan([c], SWEEP_NOW, { waitingHours: 24 }).items).toHaveLength(1);
  });
});

describe("approved cases whose claim is not marked filed", () => {
  const approved = () => ({ ...openCase("ap", { deadlineHours: 200, eur: 52.9 }), status: "approved" as const });

  it("lists the case with the verb 'file the claim' and the money", () => {
    const [item] = buildSweepPlan([approved()], SWEEP_NOW).items;
    expect(item.action).toBe("file_claim");
    expect(item.reasons.map((r) => r.kind)).toEqual(["claim_not_filed"]);
    expect(item.amountEur).toBe(52.9);
  });

  it("drops it once the merchant marked the claim as filed, deadlines included", () => {
    const filed = { ...approved(), claim: claimOf({ claimDeadline: at(10), maxCompensationEur: 52.9 }), claimFiledAt: at(-1) };
    expect(buildSweepPlan([filed], SWEEP_NOW).items).toHaveLength(0);
  });

  it("brings it back when the mark is cleared (null)", () => {
    expect(buildSweepPlan([{ ...approved(), claimFiledAt: null }], SWEEP_NOW).items).toHaveLength(1);
  });
});

describe("cases that need a human, and cases that are closed", () => {
  it("lists a flagged case and a case without a decision as needing a human", () => {
    const flagged = openCase("flag", { deadlineHours: null });
    flagged.decision = { ...flagged.decision!, needsHuman: true };
    const none = openCase("none", { deadlineHours: null, eur: 0 });
    none.decision = null;
    const plan = buildSweepPlan([flagged, none], SWEEP_NOW);
    expect(plan.items.every((i) => i.reasons[0].kind === "needs_human")).toBe(true);
    expect(plan.counts.needHuman).toBe(2);
  });

  it("flags a run stuck at 'new' for more than an hour, not a fresh one", () => {
    const stuck = makeCase({ id: "stuck", status: "new", claim: null, decision: null, assessment: null, updatedAt: at(-5), createdAt: at(-5) });
    const fresh = makeCase({ id: "fresh", status: "new", claim: null, decision: null, assessment: null, updatedAt: at(-0.2), createdAt: at(-0.2) });
    const plan = buildSweepPlan([stuck, fresh], SWEEP_NOW);
    expect(plan.items.map((i) => i.caseId)).toEqual(["stuck"]);
    expect(plan.items[0].action).toBe("check_failed_run");
    expect(plan.counts.needHuman).toBe(1);
  });

  it("leaves rejected and sent cases out", () => {
    const rejected = { ...openCase("r"), status: "rejected" as const };
    const sent = { ...openCase("s"), status: "sent_to_customer" as const };
    const plan = buildSweepPlan([rejected, sent], SWEEP_NOW);
    expect(plan.items).toHaveLength(0);
    expect(plan.counts).toMatchObject({ cases: 2, open: 0, due: 0 });
  });
});

describe("recorded runs", () => {
  const recorded = (): CaseRecord => ({
    ...openCase("rec", { deadlineHours: -20 }),
    recorded: { recordedOn: "2026-10-27" },
    createdAt: "2026-10-27T16:00:00.000Z",
    claim: claimOf({ claimDeadline: "2026-10-29T10:00:00.000Z", maxCompensationEur: 25 }),
  });

  it("are left out unless asked for", () => {
    const plan = buildSweepPlan([recorded(), openCase("live")], SWEEP_NOW);
    expect(plan.items.map((i) => i.caseId)).toEqual(["live"]);
    expect(plan.counts.cases).toBe(1);
    expect(plan.includeRecorded).toBe(false);
  });

  it("are read as of their recording day when included, flagged as recorded", () => {
    const plan = buildSweepPlan([recorded()], SWEEP_NOW, { includeRecorded: true });
    const [item] = plan.items;
    expect(plan.includeRecorded).toBe(true);
    expect(item.recordedOn).toBe("2026-10-27");
    expect(item.readAt).toBe("2026-10-27T16:00:00.000Z");
    // 42 h after the recording (27 Oct 16:00 to 29 Oct 10:00), not "passed" against today's clock.
    expect(item.deadline?.hoursLeft).toBeCloseTo(42, 5);
  });
});

describe("totals and caps", () => {
  it("adds the money in cents and leaves out a simulated reply, like the header counter", () => {
    const simulated = openCase("sim", { eur: 102.3 });
    simulated.followUps = [{ id: "f", receivedAt: at(-1), message: "m", photos: [], simulated: true }];
    const plan = buildSweepPlan([openCase("a", { eur: 23 }), openCase("b", { eur: 9.2 }), simulated], SWEEP_NOW);
    expect(plan.moneyAtStakeEur).toBe(32.2);
    expect(plan.items.find((i) => i.caseId === "sim")?.simulatedReply).toBe(true);
  });

  it("keeps the list to MAX_LISTED_ITEMS and says how many were left out", () => {
    const many = Array.from({ length: MAX_LISTED_ITEMS + 4 }, (_, i) => openCase(`c${String(i).padStart(2, "0")}`, { deadlineHours: 10 + i }));
    const plan = buildSweepPlan(many, SWEEP_NOW);
    expect(plan.items).toHaveLength(MAX_LISTED_ITEMS);
    expect(plan.moreItems).toBe(4);
    expect(plan.counts.due).toBe(MAX_LISTED_ITEMS + 4);
  });

  it("holds no customer name, e-mail, address or message", () => {
    const plan = buildSweepPlan([openCase("1001", { deadlineHours: 10 }), waitingCase("1002", 70)], SWEEP_NOW);
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/camille|laurent|example\.com|Lyon|arrived broken/i);
  });

  it("refuses an invalid clock", () => {
    expect(() => buildSweepPlan([], new Date("nope"))).toThrow(TypeError);
  });
});
