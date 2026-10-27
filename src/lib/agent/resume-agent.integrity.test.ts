// The photo integrity check and the follow-up loop together (merge of 28 Oct 2026): a resumed round
// checks every photo of the case, reads only the new files, keeps what each round found, and a signal
// on a reply's photo sends the case to a human like it does on a report's.
import { describe, expect, it, vi } from "vitest";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { checkPhotoIntegrity } from "../integrity/check";
import type { IntegrityDeps, IntegrityInput } from "../integrity/check";
import { syntheticPhoto } from "../integrity/test-helpers";
import { hashImage } from "../integrity/image-hash";
import { getRounds } from "../rounds";
import type { CaseRecord, FollowUp, PhotoIntegrity } from "../types";
import { createMockProvider } from "../providers/mock";
import { resumeAgent, runAgent } from "./run-agent";
import {
  ASSESSMENT_BROKEN,
  NOW,
  cleanIntegrity,
  decisionArgs,
  fakeDeps,
  makeReport,
  scriptedProvider,
  type Turn,
} from "./test-helpers";

type Check = (input: IntegrityInput) => Promise<PhotoIntegrity>;

const ASSESSMENT_BLURRY = {
  item: "Table lamp",
  damageType: "unclear",
  severity: "none",
  carrierLikelyAtFault: false,
  packagingAdequate: null,
  evidenceNotes: ["The photo is heavily blurred."],
  photoQuality: "blurry",
};

// Photo references the agent can load (tiny data URIs, like the other resume tests).
const OLD = "data:image/png;base64,AAAA";
const NEW = "data:image/png;base64,CCCC";
const OTHER = "data:image/png;base64,DDDD";

const ASK = decisionArgs({
  decision: "ask_more_photos",
  carrierClaim: false,
  confidence: 0.9,
  reasons: ["The photo is too blurry to judge the damage."],
  customerReply: "Hello, could you send one or two sharper photos?",
});

const followUp = (over: Partial<FollowUp> = {}): FollowUp => ({
  id: "fu-1",
  receivedAt: new Date(NOW.getTime() + 2 * 86_400_000).toISOString(),
  message: "Here is a sharper photo, the vase is in pieces.",
  photos: [NEW],
  ...over,
});

const ORDER_THEN_CHECK: Turn["calls"] = [
  ["get_order", { orderNumber: "#1001" }],
  ["check_photo_integrity", {}],
];

/** Round 1 as the model plays it: reads a blurry photo and asks for another. */
async function roundOne(check: Check, photos = [OLD]): Promise<CaseRecord> {
  return runAgent(makeReport({ message: "My vase is damaged, I think.", photos }), {
    engine: "muse-spark-1.3",
    provider: scriptedProvider([
      { calls: ORDER_THEN_CHECK },
      { calls: [["assess_photos", ASSESSMENT_BLURRY]] },
      { calls: [["finish_case", ASK]] },
    ]),
    deps: fakeDeps({ checkPhotoIntegrity: check }),
    now: NOW,
  });
}

/** Round 2 as the model plays it, with the integrity tool right after the order. */
const round2Turns = (): Turn[] => [
  { calls: ORDER_THEN_CHECK },
  { calls: [["assess_photos", ASSESSMENT_BROKEN]] },
  { calls: [["compute_claim", {}]] },
  { calls: [["finish_case", decisionArgs({ reasons: ["The sharper photo shows the vase in pieces."] })]] },
  { calls: [["draft_claim_document", {}]] },
];

const toolMessages = (messages: ChatCompletionMessageParam[]) =>
  messages.filter((m): m is Extract<ChatCompletionMessageParam, { role: "tool" }> => m.role === "tool");

const REUSED_PHOTO_2: PhotoIntegrity = cleanIntegrity({
  signals: [
    {
      kind: "reused_photo",
      photoIndex: 1,
      message: "Photo 2 looks like a photo already filed in 1 other case for a different order or customer.",
    },
  ],
});

describe("resumeAgent runs the integrity check on the whole case", () => {
  it("checks the report's photos and the reply's, hands over what round 1 already found, and keeps each round's check", async () => {
    const earlier = cleanIntegrity({
      photos: [{ index: 0, hash: { dhash: "00ff00ff00ff00ff", ahash: "0f0f0f0f0f0f0f0f" }, hasExif: false, capturedAt: null, matches: [] }],
      comparedCases: 2,
    });
    const first = await roundOne(async () => earlier);
    expect(first.integrity).toEqual(earlier);

    const check = vi.fn<Check>(async () => cleanIntegrity({ calledBy: "model", comparedCases: 3, photos: [earlier.photos[0]] }));
    const provider = scriptedProvider(round2Turns());
    const second = await resumeAgent(first, followUp(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({ checkPhotoIntegrity: check }),
      now: NOW,
    });

    expect(check).toHaveBeenCalledTimes(1);
    const input = check.mock.calls[0][0];
    // Every photo of the case, in the order the customer sent them, under the id of the case.
    expect(input.report.photos).toEqual([OLD, NEW]);
    expect(input.caseId).toBe(first.id);
    expect(input.calledBy).toBe("model");
    // What round 1 hashed is passed on, so the old file is not read again; no case is ignored.
    expect(input.knownPhotos).toEqual(earlier.photos);
    expect(input.ignoreCaseIds).toBeUndefined();
    // The model sees the result as a tool result in round 2 too.
    const seen = toolMessages(provider.requests[1].messages).map((m) => JSON.parse(m.content as string));
    expect(seen[1]).toMatchObject({ checked: true, comparedWith: { earlierCases: 3 } });
    // The case holds round 2's check; round 1's stays with round 1.
    expect(second.integrity).toMatchObject({ comparedCases: 3 });
    expect(second.previousRounds?.[0].integrity).toEqual(earlier);
    expect(getRounds(second)[0].outcome?.integrity).toEqual(earlier);
    expect(getRounds(second)[1].outcome?.integrity).toMatchObject({ comparedCases: 3 });
    // The trace of round 2 carries the tool step, tagged with the round.
    const step = second.trace.find((t) => t.tool === "check_photo_integrity" && t.round === 2);
    expect(step?.step).toBe("Tool: check_photo_integrity");
  });

  it("a signal on the reply's photo sends the case to a human, and the claim is still prepared", async () => {
    const first = await roundOne(async () => cleanIntegrity());
    const second = await resumeAgent(first, followUp(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(round2Turns()),
      deps: fakeDeps({ checkPhotoIntegrity: async () => REUSED_PHOTO_2 }),
      now: NOW,
    });
    expect(second.decision).toMatchObject({ decision: "reship", carrierClaim: true, needsHuman: true });
    expect(second.decision?.reasons.join(" ")).toMatch(/Guardrail: photo integrity: Photo 2 looks like a photo already filed/);
    expect(second.document).not.toBeNull();
    expect(second.integrity?.signals).toHaveLength(1);
  });

  it("runs the check itself when the model skips it in a resumed round, and says so in the trace", async () => {
    const first = await roundOne(async () => cleanIntegrity());
    const check = vi.fn<Check>(async () => cleanIntegrity({ calledBy: "code" }));
    const second = await resumeAgent(first, followUp(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider([
        { calls: [["get_order", { orderNumber: "#1001" }]] },
        { calls: [["assess_photos", ASSESSMENT_BROKEN]] },
        { calls: [["compute_claim", {}]] },
        { calls: [["finish_case", decisionArgs()]] },
        { calls: [["draft_claim_document", {}]] },
      ]),
      deps: fakeDeps({ checkPhotoIntegrity: check }),
      now: NOW,
    });
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0][0]).toMatchObject({ calledBy: "code" });
    expect(check.mock.calls[0][0].report.photos).toHaveLength(2);
    expect(second.integrity?.calledBy).toBe("code");
    expect(second.trace.some((t) => t.round === 2 && /Photo integrity check run by the code/.test(t.step))).toBe(true);
  });

  it("a round that fails to check goes to a human, like a first round (a tool error)", async () => {
    const first = await roundOne(async () => cleanIntegrity());
    const second = await resumeAgent(first, followUp(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(round2Turns()),
      deps: fakeDeps({
        checkPhotoIntegrity: async () => {
          throw new Error("disk gone");
        },
      }),
      now: NOW,
    });
    expect(second.decision?.needsHuman).toBe(true);
    expect(second.integrity).toBeUndefined();
    expect(second.trace.some((t) => t.round === 2 && /Tool error: check_photo_integrity/.test(t.step))).toBe(true);
  });

  it("the demo mock calls the check in a resumed round too (it is real code in demo mode)", async () => {
    const check = vi.fn<Check>(async () => cleanIntegrity());
    const first = await runAgent(makeReport({ message: "The lamp photo is blurry, sorry.", orderNumber: "#1003", photos: [OLD] }), {
      engine: "demo-mock",
      provider: createMockProvider(),
      deps: fakeDeps({ checkPhotoIntegrity: check }),
      now: NOW,
    });
    expect(first.decision?.decision).toBe("ask_more_photos");
    const second = await resumeAgent(first, followUp({ message: "Here is a sharper one." }), {
      engine: "demo-mock",
      provider: createMockProvider(),
      deps: fakeDeps({ checkPhotoIntegrity: check }),
      now: NOW,
    });
    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[1][0].report.photos).toEqual([OLD, NEW]);
    expect(second.decision?.decision).toBe("reship");
    expect(second.trace.some((t) => t.round === 2 && t.tool === "check_photo_integrity")).toBe(true);
  });
});

describe("resumeAgent with the real integrity check", () => {
  /** Photos by reference, and what was opened. */
  function realDeps(photos: Record<string, Buffer>, cases: CaseRecord[] = []) {
    const readPhoto = vi.fn(async (ref: string) => {
      const bytes = photos[ref];
      if (!bytes) throw new Error(`photo not found: ${ref}`);
      return new Uint8Array(bytes);
    });
    const deps: IntegrityDeps = { listCases: async () => cases, readPhoto, demoPhotos: async () => [] };
    return { deps, readPhoto, check: (input: IntegrityInput) => checkPhotoIntegrity(input, deps) };
  }

  it("reads only the new file in round 2, and the case then carries the hashes of every round", async () => {
    const oldPhoto = await syntheticPhoto(71);
    const newPhoto = await syntheticPhoto(72);
    const real = realDeps({ [OLD]: oldPhoto, [NEW]: newPhoto });
    const first = await roundOne(real.check);
    expect(real.readPhoto.mock.calls.map((c) => c[0])).toEqual([OLD]);
    real.readPhoto.mockClear();

    const second = await resumeAgent(first, followUp(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(round2Turns()),
      deps: fakeDeps({ checkPhotoIntegrity: real.check }),
      now: NOW,
    });
    expect(real.readPhoto.mock.calls.map((c) => c[0])).toEqual([NEW]);
    expect(second.integrity?.photos.map((p) => p.index)).toEqual([0, 1]);
    expect(second.integrity?.photos[0].hash).toEqual(await hashImage(oldPhoto));
    expect(second.integrity?.photos[1].hash).toEqual(await hashImage(newPhoto));
    expect(second.decision).toMatchObject({ decision: "reship", needsHuman: false });
  });

  it("flags a reply photo that is the one filed in another case, and not the earlier photos of the same case", async () => {
    const oldPhoto = await syntheticPhoto(73);
    const stolen = await syntheticPhoto(74);
    const other: CaseRecord = {
      ...(await roundOne(realDeps({ [OTHER]: stolen }).check, [OTHER])),
      id: "case_other",
      report: makeReport({ id: "r-other", orderNumber: "#2002", customerEmail: "other@example.com", photos: [OTHER] }),
    };
    const real = realDeps({ [OLD]: oldPhoto, [NEW]: stolen }, [other]);
    const first = await roundOne(real.check);
    const second = await resumeAgent(first, followUp(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(round2Turns()),
      deps: fakeDeps({ checkPhotoIntegrity: real.check }),
      now: NOW,
    });
    expect(second.integrity?.signals).toEqual([expect.objectContaining({ kind: "reused_photo", photoIndex: 1 })]);
    expect(second.decision).toMatchObject({ needsHuman: true });
    // The message holds counts, never the other customer's order or e-mail.
    expect(JSON.stringify(second.integrity?.signals)).not.toMatch(/2002|other@example/);
  });

  it("a recorded run forked into a new case does not 'reuse' its own photos when the customer corrected the order number", async () => {
    const photo = await syntheticPhoto(75);
    const reply = await syntheticPhoto(76);
    // Round 1: the order number was wrong, nothing was found, a person is needed.
    const noOrder = async () => null;
    const probe = realDeps({ [OLD]: photo });
    const first = await runAgent(makeReport({ orderNumber: "#9999", photos: [OLD] }), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider([
        { calls: [["get_order", { orderNumber: "#9999" }], ["check_photo_integrity", {}]] },
        { calls: [["finish_case", decisionArgs({ decision: "no_action", carrierClaim: false, needsHuman: true })]] },
      ]),
      deps: fakeDeps({ getOrder: noOrder, checkPhotoIntegrity: probe.check }),
      now: NOW,
    });
    expect(first.order).toBeNull();

    // The new case (a fork) is saved under another id; the first one is still in the store.
    const real = realDeps({ [OLD]: photo, [NEW]: reply }, [first]);
    const forked = await resumeAgent(first, followUp({ orderNumber: "#1001" }), {
      engine: "muse-spark-1.3",
      forkAs: "case_fork",
      provider: scriptedProvider(round2Turns()),
      deps: fakeDeps({ checkPhotoIntegrity: real.check }),
      now: NOW,
    });
    expect(forked.id).toBe("case_fork");
    expect(forked.followedFrom).toBe(first.id);
    expect(forked.integrity?.signals).toEqual([]);
    expect(forked.integrity?.photos[0].matches).toEqual([]);

    // Without the exclusion the same photos would have matched the case they continue (control).
    const control = await checkPhotoIntegrity(
      { report: makeReport({ orderNumber: "#1001", photos: [OLD] }), caseId: "case_fork", deliveredAt: null, calledBy: "code" },
      real.deps,
    );
    expect(control.signals).toHaveLength(1);
  });
});
