// The photo integrity check inside the agent loop (27 Oct 2026): the model calls it and sees its
// result, the code runs it when the model does not, the guardrails act on its signals, and the case
// keeps it. The check itself is tested in src/lib/integrity; here it is a stub, except in the last
// group, which runs the real one on the real demo photos.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { makeCase } from "@/components/fixtures";
import { checkPhotoIntegrity, DEFAULT_INTEGRITY_DEPS } from "../integrity/check";
import type { IntegrityInput } from "../integrity/check";
import { demoPhotoBytes, syntheticPhoto } from "../integrity/test-helpers";
import { hashImage } from "../integrity/image-hash";
import type { PhotoIntegrity } from "../types";
import { runAgent } from "./run-agent";
import {
  ASSESSMENT_BROKEN,
  NOW,
  cleanIntegrity,
  decisionArgs,
  fakeDeps,
  makeOrder,
  makeReport,
  scriptedProvider,
} from "./test-helpers";

type Calls = [string, unknown][];
type Check = (input: IntegrityInput) => Promise<PhotoIntegrity>;

const REUSED: PhotoIntegrity = cleanIntegrity({
  signals: [
    {
      kind: "reused_photo",
      photoIndex: 0,
      message: "Photo 1 looks like a photo already filed in 1 other case for a different order or customer.",
    },
  ],
});

/** The whole path of a good case, with the integrity tool called right after the order. */
const turns = () => [
  {
    calls: [
      ["get_order", { orderNumber: "#1001" }],
      ["check_photo_integrity", {}],
    ] as Calls,
  },
  { calls: [["assess_photos", ASSESSMENT_BROKEN]] as Calls },
  { calls: [["compute_claim", {}]] as Calls },
  { calls: [["finish_case", decisionArgs()]] as Calls },
  { calls: [["draft_claim_document", {}]] as Calls },
];

const toolMessages = (messages: ChatCompletionMessageParam[]) =>
  messages.filter((m): m is Extract<ChatCompletionMessageParam, { role: "tool" }> => m.role === "tool");

describe("check_photo_integrity called by the model", () => {
  it("shows the model the result as a tool result, records it on the case and in the trace", async () => {
    const check = vi.fn<Check>(async () =>
      cleanIntegrity({ comparedCases: 3, comparedPhotos: 3, comparedDemoPhotos: 6 }),
    );
    const provider = scriptedProvider(turns());
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({ checkPhotoIntegrity: check }),
      now: NOW,
    });

    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0][0]).toMatchObject({ calledBy: "model", deliveredAt: "2026-10-25T14:00:00.000Z" });
    // What the model saw on its next turn.
    const seen = toolMessages(provider.requests[1].messages).map((m) => JSON.parse(m.content as string));
    expect(seen[1]).toMatchObject({ checked: true, comparedWith: { earlierCases: 3, photos: 3, demoPhotos: 6 }, signals: [] });
    // The case.
    expect(c.integrity).toMatchObject({ calledBy: "model", comparedCases: 3 });
    const step = c.trace.find((t) => t.tool === "check_photo_integrity");
    expect(step?.step).toBe("Tool: check_photo_integrity");
    expect(c.decision).toMatchObject({ needsHuman: false, carrierClaim: true });
  });

  it("gets the delivery date of the order the model looked up", async () => {
    const check = vi.fn<Check>(async () => cleanIntegrity());
    await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(turns()),
      deps: fakeDeps({ checkPhotoIntegrity: check, getOrder: async () => makeOrder({ deliveredAt: "2026-10-20T08:00:00.000Z" }) }),
      now: NOW,
    });
    expect(check.mock.calls[0][0].deliveredAt).toBe("2026-10-20T08:00:00.000Z");
    expect(check.mock.calls[0][0].caseId).toMatch(/^case_/);
    expect(check.mock.calls[0][0].report.photos).toHaveLength(1);
  });

  it("a signal sends the case to a human with a clear reason, and rejects nothing", async () => {
    const provider = scriptedProvider(turns());
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({ checkPhotoIntegrity: async () => REUSED }),
      now: NOW,
    });
    expect(c.decision).toMatchObject({ decision: "reship", carrierClaim: true, needsHuman: true });
    expect(c.decision?.reasons.join(" ")).toMatch(/Guardrail: photo integrity: Photo 1 looks like a photo already filed/);
    expect(c.status).toBe("needs_review");
    expect(c.document).not.toBeNull(); // the claim is still prepared: the merchant decides
    expect(c.trace.some((t) => /^Guardrail: needsHuman forced: photo integrity/.test(t.step))).toBe(true);
    expect(c.integrity?.signals).toHaveLength(1);
    // The model was told what to do with it.
    const seen = toolMessages(provider.requests[1].messages).map((m) => JSON.parse(m.content as string));
    expect(seen[1].next).toMatch(/Do not accuse the customer/);
  });

  it("lets the model quote a date from the result: it is deterministic code output, like the rules", async () => {
    const withDate = cleanIntegrity({
      signals: [
        {
          kind: "captured_before_delivery",
          photoIndex: 0,
          message: "Photo 1 says it was taken on 2026-10-10 09:30, 15 days before the parcel was delivered (2026-10-25 14:00 UTC).",
        },
      ],
    });
    const t = turns();
    t[3] = {
      calls: [
        ["finish_case", decisionArgs({ reasons: ["Photo 1 says it was taken on 2026-10-10 09:30, before delivery."] })],
      ] as Calls,
    };
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(t),
      deps: fakeDeps({ checkPhotoIntegrity: async () => withDate }),
      now: NOW,
    });
    expect(c.decision?.reasons.join(" ")).not.toMatch(/text states figures no tool returned/);
  });

  it("a failing check is a tool error: the model is told, and the case goes to a human", async () => {
    const provider = scriptedProvider(turns());
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({
        checkPhotoIntegrity: async () => {
          throw new Error("store unreachable");
        },
      }),
      now: NOW,
    });
    expect(c.integrity).toBeUndefined();
    expect(c.trace.some((t) => /^Tool error: check_photo_integrity/.test(t.step))).toBe(true);
    expect(c.decision?.needsHuman).toBe(true);
    expect(c.decision?.reasons.join(" ")).toMatch(/tool error\(s\): check_photo_integrity/);
  });
});

describe("check_photo_integrity run by the code", () => {
  it("runs before the guardrails when the model never called it, and says so in the trace", async () => {
    const t = turns();
    t[0] = { calls: [["get_order", { orderNumber: "#1001" }]] as Calls };
    const check = vi.fn<Check>(async () => REUSED);
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(t),
      deps: fakeDeps({ checkPhotoIntegrity: check }),
      now: NOW,
    });
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0][0].calledBy).toBe("code");
    // The guardrail acted on it although the model never asked.
    expect(c.decision?.needsHuman).toBe(true);
    expect(c.integrity).toBeDefined();
    const step = c.trace.find((x) => /Photo integrity check run by the code/.test(x.step));
    expect(step?.step).toMatch(/the model did not call check_photo_integrity/);
    expect(step?.tool).toBe("check_photo_integrity");
    // The code's step comes before the decision it informs.
    const order = c.trace.map((x) => x.step);
    expect(order.findIndex((s) => /Photo integrity check run by the code/.test(s))).toBeLessThan(
      order.findIndex((s) => /^Tool: finish_case/.test(s)),
    );
  });

  it("runs the check again when the model called it before the order was known (no delivery date then)", async () => {
    const t = turns();
    t[0] = { calls: [["check_photo_integrity", {}], ["get_order", { orderNumber: "#1001" }]] as Calls };
    const check = vi.fn<Check>(async () => cleanIntegrity());
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(t),
      deps: fakeDeps({ checkPhotoIntegrity: check }),
      now: NOW,
    });
    expect(check).toHaveBeenCalledTimes(2);
    expect(check.mock.calls[0][0]).toMatchObject({ calledBy: "model", deliveredAt: null });
    expect(check.mock.calls[1][0]).toMatchObject({ calledBy: "code", deliveredAt: "2026-10-25T14:00:00.000Z" });
    expect(c.trace.find((x) => /Photo integrity check run by the code/.test(x.step))?.step).toMatch(/order was found after the model's check/);
  });

  it("does not run twice when the model called it after the order", async () => {
    const check = vi.fn<Check>(async () => cleanIntegrity());
    await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(turns()),
      deps: fakeDeps({ checkPhotoIntegrity: check }),
      now: NOW,
    });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("counts a failure of the code's own run as a tool error that forces a human", async () => {
    const t = turns();
    t[0] = { calls: [["get_order", { orderNumber: "#1001" }]] as Calls };
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider(t),
      deps: fakeDeps({
        checkPhotoIntegrity: async () => {
          throw new Error("boom");
        },
      }),
      now: NOW,
    });
    expect(c.decision?.needsHuman).toBe(true);
    expect(c.trace.some((x) => /^Tool error: photo integrity check failed \(boom\)/.test(x.step))).toBe(true);
  });

  it("has no integrity on a case that never reached a decision", async () => {
    const check = vi.fn<Check>(async () => cleanIntegrity());
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider: scriptedProvider([{ throws: new Error("model down") }]),
      deps: fakeDeps({ checkPhotoIntegrity: check }),
      now: NOW,
    });
    expect(c.integrity).toBeUndefined();
    expect(check).not.toHaveBeenCalled();
    expect(c.decision?.needsHuman).toBe(true);
  });
});

describe("the real check inside the loop, on the demo photos", () => {
  const demoDeps = (cases: Parameters<typeof checkPhotoIntegrity>[1]["listCases"]) =>
    fakeDeps({
      checkPhotoIntegrity: (input) => checkPhotoIntegrity(input, { ...DEFAULT_INTEGRITY_DEPS, listCases: cases }),
    });

  it("demo mode, the broken vase of its own demo case: checked, nothing found, hashes kept on the case", async () => {
    const c = await runAgent(
      makeReport({ photos: ["data/photos/vase-broken.webp"], customerEmail: "camille.laurent@example.com", orderNumber: "#1001" }),
      { engine: "demo-mock", deps: demoDeps(async () => []), now: NOW, env: {} },
    );
    expect(c.engine).toBe("demo-mock");
    expect(c.integrity).toBeDefined();
    expect(c.integrity?.signals).toEqual([]);
    expect(c.integrity?.comparedDemoPhotos).toBe(6);
    expect(c.integrity?.photos[0].hash).toEqual(await hashImage(demoPhotoBytes("vase-broken")));
    expect(c.integrity?.photos[0].matches[0]).toMatchObject({ source: "demo", sameOrderAndCustomer: true });
    // The mock calls the tool right after the order, as the system prompt asks.
    const tools = c.trace.map((t) => t.tool).filter(Boolean);
    expect(tools.slice(0, 2)).toEqual(["get_order", "check_photo_integrity"]);
    expect(c.decision?.needsHuman).toBe(false);
    // Small enough to live on the case.
    expect(JSON.stringify(c.integrity).length).toBeLessThan(1500);
  });

  it("demo mode, the same demo photo filed for another order: a signal, a human, no rejection", async () => {
    const c = await runAgent(
      makeReport({ photos: ["data/photos/vase-broken.webp"], customerEmail: "hugo.bernard@example.com", orderNumber: "1002" }),
      {
        engine: "demo-mock",
        deps: demoDeps(async () => []),
        now: NOW,
        env: {},
      },
    );
    expect(c.integrity?.signals.map((s) => s.kind)).toEqual(["demo_photo_reused"]);
    expect(c.decision?.needsHuman).toBe(true);
    expect(c.decision?.reasons.join(" ")).toMatch(/photo integrity check reported something to look at/);
    expect(c.decision?.reasons.join(" ")).toMatch(/Guardrail: photo integrity: Photo 1 is one of the demo photos/);
    expect(c.status).toBe("needs_review");
  });

  it("flags a photo already stored on another case, using the hashes kept on that case", async () => {
    const original = await syntheticPhoto(42);
    const hash = await hashImage(original);
    const earlier = makeCase({ id: "case_earlier" });
    earlier.report = { ...earlier.report, orderNumber: "#1005", customerEmail: "someone.else@example.com" };
    earlier.integrity = cleanIntegrity({ photos: [{ index: 0, hash, hasExif: false, capturedAt: null, matches: [] }] });
    const dir = await mkdtemp(path.join(os.tmpdir(), "dd-integrity-"));
    try {
      const file = path.join(dir, "photo-1.jpg");
      await writeFile(file, original);
      const c = await runAgent(makeReport({ photos: [file] }), {
        engine: "demo-mock",
        deps: demoDeps(async () => [earlier]),
        now: NOW,
        env: {},
      });
      expect(c.integrity?.signals.map((s) => s.kind)).toEqual(["reused_photo"]);
      expect(c.integrity?.photos[0].matches[0]).toMatchObject({ source: "case", caseId: "case_earlier" });
      expect(c.decision?.needsHuman).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
