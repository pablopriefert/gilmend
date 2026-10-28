import { describe, expect, it } from "vitest";
import { makeCase, NOW } from "@/components/fixtures";
import type { CarrierId, CaseRecord, DecisionKind } from "../types";
import {
  buildInsights,
  CARRIER_ORDER,
  formatCountdown,
  reserveLabel,
  TIMELINE_HORIZON_DAYS,
  windowLabel,
  windowLabelShort,
} from "./insights";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const inHours = (h: number) => iso(NOW.getTime() + h * HOUR);

/** A case that holds money: `eur` claimable at `carrier`, deadline and reserve in `hours` from NOW. */
function claimCase(
  id: string,
  carrier: CarrierId,
  eur: number,
  claimHours: number,
  opts: { reserveHours?: number | null; decision?: DecisionKind; status?: CaseRecord["status"]; recorded?: boolean } = {},
): CaseRecord {
  const base = makeCase();
  const created = opts.recorded ? NOW.getTime() - 5 * 24 * HOUR : NOW.getTime();
  const readAtMs = opts.recorded ? created : NOW.getTime();
  const at = (h: number) => iso(readAtMs + h * HOUR);
  return makeCase({
    id,
    status: opts.status ?? "needs_review",
    createdAt: iso(created),
    order: { ...base.order!, id: `#${id}`, carrier },
    claim: {
      eligible: true,
      reasons: [],
      maxCompensationEur: eur,
      claimDeadline: at(claimHours),
      reserveDeadline: opts.reserveHours === null ? null : at(opts.reserveHours ?? claimHours),
      daysLeft: Math.floor(claimHours / 24),
    },
    decision: { ...base.decision!, decision: opts.decision ?? "reship", carrierClaim: true },
    ...(opts.recorded ? { recorded: { recordedOn: "2026-10-23" } } : {}),
  });
}

describe("buildInsights: carriers", () => {
  it("always lists the five carriers, the short windows first, with zeros when there is nothing", () => {
    const i = buildInsights([], NOW, { includeRecorded: false });
    expect(i.carriers.map((c) => c.carrier)).toEqual(["mondial_relay", "chronopost", "colissimo", "dhl_paket", "gls"]);
    expect(i.carriers.every((c) => c.openClaims === 0 && c.recoverableEur === 0)).toBe(true);
    expect(i.recoverableEur).toBe(0);
    expect(i.openClaims).toBe(0);
  });

  it("adds the maximum compensation per carrier in cents, without floating-point dust", () => {
    const cases = [
      claimCase("a", "colissimo", 23.1, 100),
      claimCase("b", "colissimo", 9.2, 100),
      claimCase("c", "mondial_relay", 25, 40),
      claimCase("d", "chronopost", 250, 60),
    ];
    const i = buildInsights(cases, NOW, { includeRecorded: false });
    const by = Object.fromEntries(i.carriers.map((c) => [c.carrier, c]));
    expect(by.colissimo).toMatchObject({ openClaims: 2, recoverableEur: 32.3 });
    expect(by.mondial_relay).toMatchObject({ openClaims: 1, recoverableEur: 25 });
    expect(by.chronopost).toMatchObject({ openClaims: 1, recoverableEur: 250 });
    expect(i.recoverableEur).toBe(307.3);
    expect(i.openClaims).toBe(4);
  });

  it("does not count a rejected case, an ineligible claim, a claim the agent declined, or a passed deadline", () => {
    const base = claimCase("ok", "colissimo", 50, 100);
    const rejected = claimCase("rej", "colissimo", 50, 100, { status: "rejected" });
    const ineligible = { ...claimCase("inel", "colissimo", 50, 100), claim: { ...base.claim!, eligible: false, maxCompensationEur: 0 } };
    const declined = claimCase("dec", "colissimo", 50, 100);
    declined.decision = { ...declined.decision!, carrierClaim: false };
    const expired = claimCase("exp", "colissimo", 50, -2);
    const i = buildInsights([base, rejected, ineligible, declined, expired], NOW, { includeRecorded: false });
    expect(i.openClaims).toBe(1);
    expect(i.recoverableEur).toBe(50);
  });

  it("counts an approved claim as still claimable", () => {
    const i = buildInsights([claimCase("a", "chronopost", 80, 30, { status: "approved" })], NOW, { includeRecorded: false });
    expect(i.openClaims).toBe(1);
  });

  it("states each carrier's window from the rules, not from a copy", () => {
    expect(windowLabel("mondial_relay")).toBe("3 days after delivery");
    expect(windowLabel("chronopost")).toBe("3 days after delivery");
    expect(windowLabel("colissimo")).toBe("365 days after shipment (counted from the order date, the safe side)");
    expect(windowLabelShort("colissimo")).toBe("365 days after shipment");
    expect(windowLabelShort("chronopost")).toBe("3 days after delivery");
    expect(reserveLabel("mondial_relay")).toBe("72 h reserve window");
    expect(reserveLabel("colissimo")).toBe("72 h reserve window (prudential)");
    expect(CARRIER_ORDER).toHaveLength(5);
  });

  it("counts a DHL Paket and a GLS claim, with the window the German rules state", () => {
    const i = buildInsights([claimCase("d", "dhl_paket", 54, 100), claimCase("g", "gls", 120, 100)], NOW, { includeRecorded: false });
    const by = Object.fromEntries(i.carriers.map((c) => [c.carrier, c]));
    expect(by.dhl_paket).toMatchObject({ openClaims: 1, recoverableEur: 54, windowLabel: "7 days after delivery", reserveLabel: "168 h reserve window" });
    expect(by.gls).toMatchObject({ openClaims: 1, recoverableEur: 120, windowLabel: "365 days after delivery", reserveLabel: "168 h reserve window (prudential)" });
    expect(i.recoverableEur).toBe(174);
    expect(i.openClaims).toBe(2);
  });
});

describe("buildInsights: recorded runs", () => {
  const live = claimCase("live", "colissimo", 40, 100);
  const recorded = claimCase("rec", "mondial_relay", 25, 48, { recorded: true });

  it("leaves recorded runs out unless asked, so the live numbers stay live", () => {
    const i = buildInsights([live, recorded], NOW, { includeRecorded: false });
    expect(i.cases).toBe(1);
    expect(i.recoverableEur).toBe(40);
    expect(i.includeRecorded).toBe(false);
  });

  it("counts them on request, each read as of its own recording rather than as overdue", () => {
    // The recording is 5 days old: read against NOW its 48 h deadline is long gone.
    const i = buildInsights([live, recorded], NOW, { includeRecorded: true });
    expect(i.cases).toBe(2);
    expect(i.recoverableEur).toBe(65);
    const event = i.timeline.events.find((e) => e.caseId === "rec" && e.kind === "claim");
    expect(event).toMatchObject({ hoursFromRead: 48, recordedOn: "2026-10-23", urgent: true });
  });

  it("marks a live event with no recording day", () => {
    const i = buildInsights([live], NOW, { includeRecorded: true });
    expect(i.timeline.events.every((e) => e.recordedOn === null)).toBe(true);
  });
});

describe("buildInsights: deadline timeline", () => {
  it("lists the claim deadlines of the next 14 days in order, most urgent first", () => {
    const cases = [
      claimCase("late", "chronopost", 100, 10 * 24, { reserveHours: 10 * 24 }),
      claimCase("soon", "mondial_relay", 25, 20),
      claimCase("mid", "chronopost", 60, 5 * 24),
    ];
    const { timeline } = buildInsights(cases, NOW, { includeRecorded: false });
    expect(timeline.horizonDays).toBe(TIMELINE_HORIZON_DAYS);
    expect(timeline.events.map((e) => e.caseId)).toEqual(["soon", "mid", "late"]);
    expect(timeline.events.map((e) => e.kind)).toEqual(["claim", "claim", "claim"]);
    expect(timeline.events[0]).toMatchObject({ hoursFromRead: 20, urgent: true, amountEur: 25, carrier: "mondial_relay" });
    expect(timeline.events[1]).toMatchObject({ hoursFromRead: 120, urgent: false });
  });

  it("flags the 3-day mark as urgent and the moment after it as not", () => {
    const { timeline } = buildInsights(
      [claimCase("edge", "chronopost", 10, 72), claimCase("over", "chronopost", 10, 73)],
      NOW,
      { includeRecorded: false },
    );
    expect(timeline.events.find((e) => e.caseId === "edge")?.urgent).toBe(true);
    expect(timeline.events.find((e) => e.caseId === "over")?.urgent).toBe(false);
  });

  it("puts a claim that closes after the horizon in 'later', with its money and first date, not on the chart", () => {
    const cases = [
      claimCase("a", "colissimo", 30, 20 * 24, { reserveHours: null }),
      claimCase("b", "colissimo", 20, 40 * 24, { reserveHours: null }),
      claimCase("c", "chronopost", 7, 2 * 24),
    ];
    const { timeline } = buildInsights(cases, NOW, { includeRecorded: false });
    expect(timeline.events.map((e) => e.caseId)).toEqual(["c"]);
    expect(timeline.later).toEqual({ count: 2, eur: 50, firstAt: inHours(20 * 24) });
  });

  it("adds the reserve window as its own event when it closes at another time than the claim (Colissimo)", () => {
    const { timeline } = buildInsights([claimCase("col", "colissimo", 52.9, 360 * 24, { reserveHours: 40 })], NOW, {
      includeRecorded: false,
    });
    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0]).toMatchObject({ kind: "reserve", binding: false, amountEur: null, hoursFromRead: 40 });
    expect(timeline.later.count).toBe(1);
  });

  it("does not double a window that is the same moment as the claim deadline (Mondial Relay, Chronopost)", () => {
    const { timeline } = buildInsights([claimCase("mr", "mondial_relay", 25, 40, { reserveHours: 40 })], NOW, {
      includeRecorded: false,
    });
    expect(timeline.events.map((e) => e.kind)).toEqual(["claim"]);
  });

  it("marks a Mondial Relay or Chronopost reserve window as binding", () => {
    const { timeline } = buildInsights([claimCase("ch", "chronopost", 90, 10 * 24, { reserveHours: 30 })], NOW, {
      includeRecorded: false,
    });
    const reserve = timeline.events.find((e) => e.kind === "reserve");
    expect(reserve?.binding).toBe(true);
  });

  it("skips a reserve window that has already closed when the case is read", () => {
    const { timeline } = buildInsights([claimCase("col", "colissimo", 52.9, 360 * 24, { reserveHours: -5 })], NOW, {
      includeRecorded: false,
    });
    expect(timeline.events).toEqual([]);
  });

  it("honours another horizon", () => {
    const { timeline } = buildInsights([claimCase("a", "chronopost", 9, 5 * 24)], NOW, { includeRecorded: false, horizonDays: 3 });
    expect(timeline.events).toEqual([]);
    expect(timeline.later.count).toBe(1);
  });
});

describe("buildInsights: decisions", () => {
  it("counts the four decisions with their share of the cases that have one", () => {
    const base = makeCase();
    const withDecision = (id: string, d: DecisionKind, needsHuman = false): CaseRecord =>
      makeCase({ id, decision: { ...base.decision!, decision: d, needsHuman, carrierClaim: d === "reship" } });
    const cases = [
      withDecision("1", "reship"),
      withDecision("2", "reship", true),
      withDecision("3", "refund"),
      withDecision("4", "ask_more_photos"),
      makeCase({ id: "5", decision: null, status: "new" }),
    ];
    const { decisions } = buildInsights(cases, NOW, { includeRecorded: false });
    expect(decisions.total).toBe(4);
    expect(decisions.items.map((d) => [d.decision, d.count])).toEqual([
      ["reship", 2],
      ["refund", 1],
      ["ask_more_photos", 1],
      ["no_action", 0],
    ]);
    expect(decisions.items[0].share).toBe(0.5);
    expect(decisions.needsHuman).toBe(1);
    expect(decisions.withCarrierClaim).toBe(2);
  });

  it("has zero shares, not NaN, with no decision at all", () => {
    const { decisions } = buildInsights([], NOW, { includeRecorded: false });
    expect(decisions.total).toBe(0);
    expect(decisions.items.every((d) => d.share === 0)).toBe(true);
  });

  it("counts demo-mode cases among those counted, so the page can say they are scripted", () => {
    const i = buildInsights([makeCase({ id: "m", engine: "demo-mock" }), makeCase({ id: "l" })], NOW, { includeRecorded: false });
    expect(i.demoModeCases).toBe(1);
  });
});

describe("formatCountdown", () => {
  it("reads days and hours, or hours alone", () => {
    expect(formatCountdown(0.4)).toBe("in under 1 h");
    expect(formatCountdown(5.9)).toBe("in 5 h");
    expect(formatCountdown(48)).toBe("in 2 d");
    expect(formatCountdown(52.5)).toBe("in 2 d 4 h");
    expect(formatCountdown(-1)).toBe("passed");
    expect(formatCountdown(Number.NaN)).toBe("unknown");
  });
});
