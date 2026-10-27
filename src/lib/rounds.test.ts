import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeCase } from "@/components/fixtures";
import {
  MAX_FOLLOW_UPS,
  allPhotos,
  caseRound,
  followUpAvailability,
  getRounds,
  groupTraceByRound,
  quotedOrderNumber,
  snapshotRound,
  workingReport,
} from "./rounds";
import { createCaseStore } from "./store/file-store";
import type { CaseRecord, Decision, FollowUp } from "./types";

const SHOWCASE_CASES = path.join(process.cwd(), "data", "showcase", "cases");

const followUp = (over: Partial<FollowUp> = {}): FollowUp => ({
  id: "fu-1",
  receivedAt: "2026-10-29T09:00:00.000Z",
  message: "Here is a sharper photo.",
  photos: ["data/runtime/uploads/fu-1/photo-1.webp"],
  ...over,
});

const asking = (over: Partial<Decision> = {}): Decision => ({
  decision: "ask_more_photos",
  carrierClaim: false,
  confidence: 0.9,
  reasons: ["The photo is blurry."],
  needsHuman: false,
  customerReply: "Could you send a sharper photo?",
  ...over,
});

const blurryCase = (over: Partial<CaseRecord> = {}): CaseRecord =>
  makeCase({
    assessment: { ...makeCase().assessment!, damageType: "unclear", photoQuality: "blurry", severity: "none" },
    claim: null,
    decision: asking(),
    document: null,
    ...over,
  });

describe("cases saved before follow-ups existed (the type migration)", () => {
  it("reads every committed recorded run as a single round, whose outcome is the case itself", async () => {
    const files = (await readdir(SHOWCASE_CASES)).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(6);
    for (const file of files) {
      const c = JSON.parse(await readFile(path.join(SHOWCASE_CASES, file), "utf8")) as CaseRecord;
      // The recordings were written before the two new fields: they carry neither.
      expect(c.followUps, file).toBeUndefined();
      expect(c.previousRounds, file).toBeUndefined();

      expect(caseRound(c), file).toBe(1);
      expect(allPhotos(c), file).toEqual(c.report.photos);
      expect(quotedOrderNumber(c), file).toBe(c.report.orderNumber);
      const rounds = getRounds(c);
      expect(rounds, file).toHaveLength(1);
      expect(rounds[0]).toMatchObject({ number: 1, followUp: null, startedAt: c.report.receivedAt, current: true, status: c.status });
      expect(rounds[0].outcome?.decision, file).toEqual(c.decision);
      expect(rounds[0].outcome?.recorded, file).toEqual(c.recorded);
      expect(groupTraceByRound(c.trace), file).toHaveLength(1);
    }
  });

  it("offers a follow-up on the recorded blurry-lamp run and on no other recording", async () => {
    const offered: string[] = [];
    for (const file of (await readdir(SHOWCASE_CASES)).filter((f) => f.endsWith(".json"))) {
      const c = JSON.parse(await readFile(path.join(SHOWCASE_CASES, file), "utf8")) as CaseRecord;
      if (followUpAvailability(c).available) offered.push(c.id);
    }
    expect(offered).toEqual(["real_demo-3-photo-blurry"]);
  });

  it("keeps the new fields through the file store, and an old file without them still loads", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dd-rounds-"));
    try {
      const store = createCaseStore({ dir });
      const old = makeCase({ id: "old-case" });
      await store.save(old);
      expect((await store.get("old-case"))?.followUps).toBeUndefined();

      const followed = makeCase({
        id: "followed",
        followUps: [followUp()],
        previousRounds: [snapshotRound(blurryCase())],
      });
      await store.save(followed);
      const back = await store.get("followed");
      expect(back?.followUps).toEqual([followUp()]);
      expect(back?.previousRounds?.[0]).toMatchObject({ number: 1, decision: { decision: "ask_more_photos" } });
      // An unrelated update keeps them (the merge only replaces what the patch names).
      const updated = await store.update("followed", { status: "approved" });
      expect(updated.followUps).toHaveLength(1);
      expect(updated.previousRounds).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("rounds of a followed-up case", () => {
  it("numbers the case, lists every photo in the order sent, and rebuilds each round", () => {
    const first = blurryCase({ status: "approved" });
    const replied = makeCase({
      report: first.report,
      followUps: [followUp(), followUp({ id: "fu-2", receivedAt: "2026-10-30T09:00:00.000Z", photos: ["p2.webp", "p3.webp"] })],
      previousRounds: [snapshotRound(first), { ...snapshotRound(blurryCase()), number: 2, status: "needs_review" }],
    });
    expect(caseRound(replied)).toBe(3);
    expect(allPhotos(replied)).toEqual([...first.report.photos, "data/runtime/uploads/fu-1/photo-1.webp", "p2.webp", "p3.webp"]);

    const rounds = getRounds(replied);
    expect(rounds.map((r) => [r.number, r.current, r.followUp?.id ?? null])).toEqual([
      [1, false, null],
      [2, false, "fu-1"],
      [3, true, "fu-2"],
    ]);
    // Round 1 keeps what the merchant had done to it when the reply came: the request was approved.
    expect(rounds[0].status).toBe("approved");
    expect(rounds[0].outcome?.decision?.decision).toBe("ask_more_photos");
    expect(rounds[2].outcome?.decision).toEqual(replied.decision);
    expect(rounds[2].startedAt).toBe("2026-10-30T09:00:00.000Z");
  });

  it("tolerates a case hand-edited so that a round lost its record", () => {
    const c = makeCase({ followUps: [followUp()], previousRounds: [] });
    const rounds = getRounds(c);
    expect(rounds).toHaveLength(2);
    expect(rounds[0].outcome).toBeNull();
    expect(rounds[1].outcome).not.toBeNull();
  });

  it("freezes the current round as the previous one, recording flag included", () => {
    const c = blurryCase({ recorded: { recordedOn: "2026-10-27" }, status: "approved" });
    expect(snapshotRound(c)).toMatchObject({
      number: 1,
      status: "approved",
      recorded: { recordedOn: "2026-10-27" },
      decision: { decision: "ask_more_photos" },
      finishedAt: c.updatedAt,
    });
  });

  it("builds the working report: the original, with every photo and the latest order number", () => {
    const c = blurryCase({ followUps: [followUp({ orderNumber: "#1099" })], previousRounds: [snapshotRound(blurryCase())] });
    const next = followUp({ id: "fu-2", photos: ["new.webp"] });
    const working = workingReport(c, next);
    expect(working.photos).toEqual([...c.report.photos, "data/runtime/uploads/fu-1/photo-1.webp", "new.webp"]);
    // The report date stays the ORIGINAL one: the reserve window is about when damage was first reported.
    expect(working.receivedAt).toBe(c.report.receivedAt);
    expect(working.orderNumber).toBe("#1099");
    expect(workingReport(c, followUp({ orderNumber: " #1100 " })).orderNumber).toBe("#1100");
    // The stored report is not touched.
    expect(c.report.photos).toHaveLength(1);
  });
});

describe("followUpAvailability", () => {
  it("is open on an 'ask for more photos' decision, with what is missing and the round it would start", () => {
    expect(followUpAvailability(blurryCase())).toEqual({ available: true, missing: ["photos"], nextRound: 2 });
  });

  it("stays open once the request was approved (the customer answers after it went out)", () => {
    expect(followUpAvailability(blurryCase({ status: "approved" }))).toMatchObject({ available: true });
  });

  it("is open when a human is needed because the photos cannot be read, or the order cannot be found", () => {
    const blurryButHuman = blurryCase({ decision: asking({ decision: "no_action", needsHuman: true }) });
    expect(followUpAvailability(blurryButHuman)).toMatchObject({ available: true, missing: ["photos"] });

    const noOrder = makeCase({
      order: null,
      decision: { ...asking({ decision: "no_action", needsHuman: true }), customerReply: "Which order?" },
    });
    expect(followUpAvailability(noOrder)).toMatchObject({ available: true, missing: ["order"] });

    // (the guardrails always raise needsHuman when the order is missing)
    const both = blurryCase({ order: null, decision: asking({ needsHuman: true }) });
    expect(followUpAvailability(both)).toMatchObject({ available: true, missing: ["photos", "order"] });
  });

  it("is closed when nothing was asked, when the case is rejected, unfinished or full", () => {
    expect(followUpAvailability(makeCase())).toEqual({ available: false, reason: "not_needed" });
    // A human is needed, but for the order value: the customer has nothing to add.
    expect(followUpAvailability(makeCase({ decision: { ...makeCase().decision!, needsHuman: true } }))).toEqual({
      available: false,
      reason: "not_needed",
    });
    expect(followUpAvailability(blurryCase({ status: "rejected" }))).toEqual({ available: false, reason: "closed" });
    expect(followUpAvailability(blurryCase({ status: "new", decision: null }))).toEqual({ available: false, reason: "no_decision" });
    const full = blurryCase({
      followUps: Array.from({ length: MAX_FOLLOW_UPS }, (_, i) => followUp({ id: `fu-${i}` })),
    });
    expect(followUpAvailability(full)).toEqual({ available: false, reason: "limit" });
  });
});

describe("groupTraceByRound", () => {
  it("cuts a trace at each round and reads a step with no round as round 1", () => {
    const at = "2026-10-28T10:00:00.000Z";
    const groups = groupTraceByRound([
      { step: "a", at },
      { step: "b", at },
      { step: "Round 2 starts", at, round: 2 },
      { step: "c", at, round: 2 },
      { step: "Round 3 starts", at, round: 3 },
    ]);
    expect(groups.map((g) => [g.round, g.steps.map((s) => s.step)])).toEqual([
      [1, ["a", "b"]],
      [2, ["Round 2 starts", "c"]],
      [3, ["Round 3 starts"]],
    ]);
    expect(groupTraceByRound([])).toEqual([]);
  });
});
