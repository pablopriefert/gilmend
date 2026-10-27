import { describe, expect, it } from "vitest";
import { fauxCase } from "./faux-cases";
import {
  claimsDueThisWeek,
  isRecoverable,
  recoverableThisMonthEur,
  summarizeCases,
  summarizeRecordedRuns,
} from "./summary";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

describe("isRecoverable", () => {
  it("accepts approved and needs_review cases with an eligible, open claim", () => {
    expect(isRecoverable(fauxCase({ id: "a", status: "approved" }), NOW)).toBe(true);
    expect(isRecoverable(fauxCase({ id: "b", status: "needs_review" }), NOW)).toBe(true);
  });
  it("rejects other statuses", () => {
    for (const status of ["new", "rejected", "sent_to_customer"] as const) {
      expect(isRecoverable(fauxCase({ id: status, status }), NOW)).toBe(false);
    }
  });
  it("rejects ineligible or missing claims", () => {
    expect(isRecoverable(fauxCase({ id: "c", claim: { eligible: false } }), NOW)).toBe(false);
    expect(isRecoverable(fauxCase({ id: "d", claim: null }), NOW)).toBe(false);
  });
  it("rejects a claim the agent decided not to file, but not a missing decision", () => {
    expect(isRecoverable(fauxCase({ id: "e", carrierClaim: false }), NOW)).toBe(false);
    expect(isRecoverable(fauxCase({ id: "f", carrierClaim: null }), NOW)).toBe(true);
  });
  it("rejects a claim whose deadline has already passed", () => {
    expect(isRecoverable(fauxCase({ id: "g", claim: { claimDeadline: inDays(-1) } }), NOW)).toBe(false);
  });
});

describe("recoverableThisMonthEur", () => {
  it("sums maxCompensationEur of recoverable cases created this month, to the cent", () => {
    const cases = [
      fauxCase({ id: "1", claim: { maxCompensationEur: 48.3, claimDeadline: inDays(2) } }),
      fauxCase({ id: "2", status: "approved", claim: { maxCompensationEur: 25, claimDeadline: inDays(1) } }),
      fauxCase({ id: "3", claim: { maxCompensationEur: 0.1, claimDeadline: inDays(1) } }),
      fauxCase({ id: "4", claim: { maxCompensationEur: 0.2, claimDeadline: inDays(1) } }),
    ];
    expect(recoverableThisMonthEur(cases, NOW)).toBe(73.6);
  });

  it("leaves out ineligible, rejected, late and other-month cases", () => {
    const cases = [
      fauxCase({ id: "in", claim: { maxCompensationEur: 100, claimDeadline: inDays(3) } }),
      fauxCase({ id: "rej", status: "rejected", claim: { maxCompensationEur: 999 } }),
      fauxCase({ id: "no", claim: { eligible: false, maxCompensationEur: 999 } }),
      fauxCase({ id: "late", claim: { maxCompensationEur: 999, claimDeadline: inDays(-2) } }),
      fauxCase({ id: "sept", createdAt: "2026-09-28T10:00:00.000Z", claim: { maxCompensationEur: 999, claimDeadline: inDays(3) } }),
    ];
    expect(recoverableThisMonthEur(cases, NOW)).toBe(100);
  });

  it("uses the Paris calendar month: 00:30 on 1 November in Paris is already November", () => {
    // 2026-10-31T23:30Z is 00:30 on 1 November in Paris (UTC+1 after the clock change).
    const justAfterMidnightParis = fauxCase({
      id: "edge",
      createdAt: "2026-10-31T23:30:00.000Z",
      claim: { maxCompensationEur: 50, claimDeadline: "2026-11-05T00:00:00.000Z" },
    });
    expect(recoverableThisMonthEur([justAfterMidnightParis], new Date("2026-11-03T10:00:00.000Z"))).toBe(50);
    expect(recoverableThisMonthEur([justAfterMidnightParis], new Date("2026-10-31T20:00:00.000Z"))).toBe(0);
  });

  it("is 0 for an empty inbox", () => {
    expect(recoverableThisMonthEur([], NOW)).toBe(0);
  });
});

describe("claimsDueThisWeek", () => {
  it("keeps recoverable claims due within 7 days, most urgent first", () => {
    const cases = [
      fauxCase({ id: "later", claim: { claimDeadline: inDays(5) } }),
      fauxCase({ id: "soon", claim: { claimDeadline: inDays(0.5) } }),
      fauxCase({ id: "far", claim: { claimDeadline: inDays(12) } }),
      fauxCase({ id: "past", claim: { claimDeadline: inDays(-1) } }),
      fauxCase({ id: "rejected", status: "rejected", claim: { claimDeadline: inDays(1) } }),
      fauxCase({ id: "ineligible", claim: { eligible: false, claimDeadline: null } }),
    ];
    expect(claimsDueThisWeek(cases, NOW).map((c) => c.id)).toEqual(["soon", "later"]);
  });

  it("includes a deadline exactly 7 days away", () => {
    const edge = fauxCase({ id: "edge", claim: { claimDeadline: inDays(7) } });
    expect(claimsDueThisWeek([edge], NOW)).toHaveLength(1);
  });
});

describe("summarizeCases", () => {
  it("returns the numbers of the header counter", () => {
    const cases = [
      fauxCase({ id: "a", claim: { maxCompensationEur: 1215, claimDeadline: inDays(2) } }),
      fauxCase({ id: "b", claim: { maxCompensationEur: 25, claimDeadline: inDays(1) } }),
      fauxCase({ id: "c", claim: { maxCompensationEur: 0, claimDeadline: inDays(9) } }),
    ];
    expect(summarizeCases(cases, NOW)).toEqual({
      recoverableThisMonthEur: 1240,
      demoModeCases: 2,
      simulatedReplyCases: 0,
      claimsDueThisWeek: 2,
      dueCaseIds: ["b", "a"],
    });
  });

  it("says how many of the counted cases come from DEMO MODE, so scripted money is not mistaken for Muse's", () => {
    const cases = [
      fauxCase({ id: "mock", engine: "demo-mock", claim: { maxCompensationEur: 100, claimDeadline: inDays(5) } }),
      fauxCase({ id: "muse", engine: "muse-spark-1.3", claim: { maxCompensationEur: 40, claimDeadline: inDays(5) } }),
      fauxCase({ id: "open", engine: "open-weights", claim: { maxCompensationEur: 10, claimDeadline: inDays(5) } }),
      // A rejected demo case holds no money: it is not counted.
      fauxCase({ id: "gone", engine: "demo-mock", status: "rejected", claim: { maxCompensationEur: 70, claimDeadline: inDays(5) } }),
    ];
    const summary = summarizeCases(cases, NOW);
    expect(summary.recoverableThisMonthEur).toBe(150);
    expect(summary.demoModeCases).toBe(1);
  });
});

describe("summarizeCases and the simulated reply of the demo button", () => {
  const withReply = (c: ReturnType<typeof fauxCase>, simulated: boolean) => ({
    ...c,
    followUps: [{ id: "fu", receivedAt: inDays(0), message: "Here is a sharper photo.", photos: ["p.webp"], ...(simulated ? { simulated: true } : {}) }],
  });

  it("keeps a claim that exists only because of a simulated reply out of the live money, and says so apart", () => {
    // The lamp of the demo: round 2 (simulated reply) gave a reship with a claim of up to 102.30.
    const rehearsal = withReply(fauxCase({ id: "lamp", engine: "muse-spark-1.3", claim: { maxCompensationEur: 102.3, claimDeadline: inDays(3) } }), true);
    const real = withReply(fauxCase({ id: "real", claim: { maxCompensationEur: 40, claimDeadline: inDays(2) } }), false);
    const plain = fauxCase({ id: "plain", claim: { maxCompensationEur: 10, claimDeadline: inDays(5) } });
    const summary = summarizeCases([rehearsal, real, plain], NOW);
    expect(summary.recoverableThisMonthEur).toBe(50);
    expect(summary.claimsDueThisWeek).toBe(2);
    expect(summary.dueCaseIds).toEqual(["real", "plain"]);
    expect(summary.simulatedReplyCases).toBe(1);
    expect(isRecoverable(rehearsal, NOW)).toBe(false);
    expect(isRecoverable(real, NOW)).toBe(true);
    expect(recoverableThisMonthEur([rehearsal], NOW)).toBe(0);
    expect(claimsDueThisWeek([rehearsal], NOW)).toEqual([]);
  });

  it("does not count a simulated case that holds no open claim (nothing was left out)", () => {
    const rejected = withReply(fauxCase({ id: "x", status: "rejected", claim: { maxCompensationEur: 90, claimDeadline: inDays(3) } }), true);
    const noClaim = withReply(fauxCase({ id: "y", carrierClaim: false }), true);
    expect(summarizeCases([rejected, noClaim], NOW).simulatedReplyCases).toBe(0);
  });

  it("still leaves out a simulated case even if a real reply came after it", () => {
    const both = {
      ...withReply(fauxCase({ id: "both", claim: { maxCompensationEur: 60, claimDeadline: inDays(3) } }), true),
    };
    both.followUps.push({ id: "fu2", receivedAt: inDays(1), message: "A real one.", photos: [] });
    expect(summarizeCases([both], NOW)).toMatchObject({ recoverableThisMonthEur: 0, simulatedReplyCases: 1 });
  });
});

describe("summarizeCases and recorded showcase runs", () => {
  it("leaves them out of every number: they are snapshots, not live money", () => {
    const live = fauxCase({ id: "live", claim: { maxCompensationEur: 40, claimDeadline: inDays(2) } });
    const recorded = {
      ...fauxCase({ id: "recorded", claim: { maxCompensationEur: 52.9, claimDeadline: inDays(2) } }),
      engine: "muse-spark-1.3" as const,
      recorded: { recordedOn: "2026-10-27" },
    };
    const summary = summarizeCases([live, recorded], NOW);
    expect(summary.recoverableThisMonthEur).toBe(40);
    expect(summary.claimsDueThisWeek).toBe(1);
    expect(summary.dueCaseIds).toEqual(["live"]);
    expect(summarizeCases([recorded], NOW)).toEqual({
      recoverableThisMonthEur: 0,
      demoModeCases: 0,
      simulatedReplyCases: 0,
      claimsDueThisWeek: 0,
      dueCaseIds: [],
    });
  });
});

describe("summarizeRecordedRuns", () => {
  // As the six recordings of 27 Oct 2026: each is read as of its own run, 3 days before its deadline.
  const recordedAt = "2026-10-27T15:07:43.875Z";
  const recorded = (id: string, eur: number, over: Partial<Parameters<typeof fauxCase>[0]> = {}) => ({
    ...fauxCase({ id, createdAt: recordedAt, claim: { maxCompensationEur: eur, claimDeadline: "2026-10-30T09:00:00.000Z" }, ...over }),
    recorded: { recordedOn: "2026-10-27" },
  });

  it("sums what the recorded runs found, to the cent, from the cases themselves", () => {
    const cases = [recorded("a", 52.9), recorded("b", 25), recorded("c", 250), fauxCase({ id: "live", claim: { maxCompensationEur: 999 } })];
    expect(summarizeRecordedRuns(cases)).toEqual({ count: 3, recoverableEur: 327.9, asOf: "2026-10-27" });
  });

  it("reads each run as of its recording: a deadline that passed since does not remove it", () => {
    // Looked at on 4 Nov the 30 Oct deadline is long gone, the figure is the one of the day of the run.
    expect(summarizeRecordedRuns([recorded("a", 25)]).recoverableEur).toBe(25);
  });

  it("leaves out a run that found nothing to claim, an ineligible one and one a visitor rejected", () => {
    const cases = [
      recorded("none", 0, { claim: null }),
      recorded("late", 40, { claim: { eligible: false, maxCompensationEur: 40, claimDeadline: null } }),
      recorded("no-claim", 40, { carrierClaim: false }),
      recorded("rejected", 40, { status: "rejected" }),
      recorded("kept", 25),
    ];
    expect(summarizeRecordedRuns(cases)).toMatchObject({ count: 5, recoverableEur: 25 });
  });

  it("is empty without recorded runs, and dates the figure from the latest recording", () => {
    expect(summarizeRecordedRuns([fauxCase({ id: "live" })])).toEqual({ count: 0, recoverableEur: 0, asOf: null });
    const later = { ...recorded("b", 10), recorded: { recordedOn: "2026-10-29" } };
    expect(summarizeRecordedRuns([recorded("a", 10), later]).asOf).toBe("2026-10-29");
  });

  it("does not change summarizeCases: the live counter still excludes the recorded runs", () => {
    expect(summarizeCases([recorded("a", 25)], NOW).recoverableThisMonthEur).toBe(0);
  });
});
