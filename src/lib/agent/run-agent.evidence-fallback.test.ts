// The evidence fallback of 27 Oct 2026: mark_damage is optional for Muse, and on the crushed-carton
// case it skipped it, so the case had no evidence. The code then asks SAM once, and says so.
import { describe, expect, it, vi } from "vitest";
import type { CaseRecord, Evidence } from "../types";
import { runAgent } from "./run-agent";
import { ASSESSMENT_BROKEN, NOW, decisionArgs, fakeDeps, makeReport, scriptedProvider } from "./test-helpers";

type Calls = [string, unknown][];

const ASSESSMENT_CARTON = {
  item: "Ceramic vase",
  damageType: "crushed_packaging",
  severity: "none",
  carrierLikelyAtFault: true,
  packagingAdequate: true,
  evidenceNotes: ["The carton is crushed, the product is intact."],
  photoQuality: "ok",
};

const noOutline = (photo: string): Evidence => ({
  photo,
  annotatedPhoto: null,
  method: "none",
  note: "SAM found no region.",
});

/** A run where the model never calls mark_damage. */
const skipMarkTurns = (assessment: Record<string, unknown>, finish: Record<string, unknown> = {}) => [
  { calls: [["get_order", {}], ["assess_photos", assessment]] as Calls },
  {
    calls: [
      ["finish_case", decisionArgs({ decision: "no_action", carrierClaim: false, reasons: ["Nothing to claim."], ...finish })],
    ] as Calls,
  },
];

const run = (
  turns: ReturnType<typeof skipMarkTurns>,
  markDamage = vi.fn(fakeDeps().markDamage),
  report = makeReport(),
  timeBudgetMs?: number,
) =>
  runAgent(report, {
    engine: "muse-spark-1.3",
    provider: scriptedProvider(turns),
    deps: fakeDeps({ markDamage }),
    now: NOW,
    ...(timeBudgetMs !== undefined ? { timeBudgetMs } : {}),
  }).then((c) => ({ c, markDamage }));

describe("runAgent: evidence fallback when the model never outlines a photo", () => {
  it("asks SAM once on the first photo, with the concepts of the assessment, and says the code did it", async () => {
    const { c, markDamage } = await run(skipMarkTurns(ASSESSMENT_CARTON));
    expect(markDamage).toHaveBeenCalledTimes(1);
    const [photo, options] = markDamage.mock.calls[0] as unknown as [string, { engine: string; concepts: string[] }];
    expect(photo).toBe(makeReport().photos[0]);
    expect(options).toMatchObject({ engine: "muse-spark-1.3", concepts: ["torn cardboard"] });
    expect(c.evidence).toHaveLength(1);
    expect(c.evidence[0]).toMatchObject({ method: "sam-3.1" });
    const step = c.trace.find((t) => t.step.startsWith("Evidence fallback"));
    expect(step?.step).toMatch(/the code \(not the model\) called mark_damage once on photo 1/);
    expect(step?.tool).toBe("mark_damage");
    expect(JSON.stringify(step?.input)).toContain("code");
  });

  it("uses the broken material for a broken product", async () => {
    const { markDamage } = await run(skipMarkTurns(ASSESSMENT_BROKEN));
    expect((markDamage.mock.calls[0] as unknown as [string, { concepts: string[] }])[1].concepts).toEqual(["broken pottery"]);
  });

  it("outlines before the claim PDF is built, so the PDF carries it", async () => {
    const buildClaimDocument = vi.fn(async (c: CaseRecord) => fakeFiledDocument(c));
    const provider = scriptedProvider([
      { calls: [["get_order", {}], ["assess_photos", ASSESSMENT_BROKEN]] as Calls },
      { calls: [["compute_claim", {}]] as Calls },
      { calls: [["finish_case", decisionArgs()]] as Calls },
      { calls: [["draft_claim_document", {}]] as Calls },
    ]);
    const c = await runAgent(makeReport(), {
      engine: "muse-spark-1.3",
      provider,
      deps: fakeDeps({ buildClaimDocument }),
      now: NOW,
    });
    expect(buildClaimDocument).toHaveBeenCalledTimes(1);
    const built = buildClaimDocument.mock.calls[0]![0];
    expect(built.evidence).toHaveLength(1);
    expect(built.evidence[0]).toMatchObject({ method: "sam-3.1" });
    expect(c.document).not.toBeNull();
  });

  it("is bounded: one call even when SAM finds nothing", async () => {
    const markDamage = vi.fn(async (photo: string) => noOutline(photo));
    const { c } = await run(skipMarkTurns(ASSESSMENT_CARTON), markDamage);
    expect(markDamage).toHaveBeenCalledTimes(1);
    expect(c.evidence[0]).toMatchObject({ method: "none", annotatedPhoto: null });
  });

  it("does not run when the model already outlined a photo", async () => {
    const turns = [
      { calls: [["get_order", {}], ["assess_photos", ASSESSMENT_CARTON], ["mark_damage", { photoIndex: 0 }]] as Calls },
      { calls: [["finish_case", decisionArgs({ decision: "no_action", carrierClaim: false })]] as Calls },
    ];
    const { c, markDamage } = await run(turns);
    expect(markDamage).toHaveBeenCalledTimes(1);
    expect(c.trace.some((t) => t.step.startsWith("Evidence fallback"))).toBe(false);
  });

  it("does not ask again when the model already tried that photo with the assessment in hand", async () => {
    const markDamage = vi.fn(async (photo: string) => noOutline(photo));
    const turns = [
      { calls: [["get_order", {}], ["assess_photos", ASSESSMENT_CARTON], ["mark_damage", { photoIndex: 0 }]] as Calls },
      { calls: [["finish_case", decisionArgs({ decision: "no_action", carrierClaim: false })]] as Calls },
    ];
    await run(turns, markDamage);
    expect(markDamage).toHaveBeenCalledTimes(1);
  });

  it("does not run for blurry photos, an unclear damage or a missing item", async () => {
    for (const over of [
      { photoQuality: "blurry" },
      { damageType: "unclear", severity: "minor" },
      { damageType: "missing_item" },
    ]) {
      const { markDamage } = await run(skipMarkTurns({ ...ASSESSMENT_CARTON, ...over }, { decision: "ask_more_photos" }));
      expect(markDamage).not.toHaveBeenCalled();
    }
  });

  it("does not run without an assessment or without a photo", async () => {
    const noAssessment = [{ calls: [["get_order", {}]] as Calls }, { calls: [["finish_case", decisionArgs({ carrierClaim: false })]] as Calls }];
    expect((await run(noAssessment)).markDamage).not.toHaveBeenCalled();
    expect((await run(skipMarkTurns(ASSESSMENT_CARTON), undefined, makeReport({ photos: [] }))).markDamage).not.toHaveBeenCalled();
  });

  // Review of 27 Oct 2026: the fallback only checked "some budget is left", so it could start at 89 s of
  // 90 and make 3 SAM calls of up to 30 s each, past the route's maxDuration of 120 s.
  it("is skipped when less than 20 s of the budget remains, and the claim keeps the raw photo", async () => {
    const { c, markDamage } = await run(skipMarkTurns(ASSESSMENT_CARTON), undefined, makeReport(), 19_000);
    expect(markDamage).not.toHaveBeenCalled();
    expect(c.evidence).toHaveLength(0);
    expect(c.trace.some((t) => t.step.startsWith("Evidence fallback"))).toBe(false);
  });

  it("gives each SAM call a third of what is left of the budget, so three calls fit", async () => {
    const { markDamage } = await run(skipMarkTurns(ASSESSMENT_CARTON), undefined, makeReport(), 60_000);
    expect(markDamage).toHaveBeenCalledTimes(1);
    const { timeoutMs } = (markDamage.mock.calls[0] as unknown as [string, { timeoutMs: number }])[1];
    // About 60 s / 3 (a few ms of the run itself are already spent), never more than a third.
    expect(timeoutMs).toBeLessThanOrEqual(20_000);
    expect(timeoutMs).toBeGreaterThan(19_000);
  });

  it("never lets three SAM calls overrun the budget, whatever is left above the minimum", async () => {
    for (const budget of [20_500, 45_000, 90_000]) {
      const { markDamage } = await run(skipMarkTurns(ASSESSMENT_CARTON), undefined, makeReport(), budget);
      const { timeoutMs } = (markDamage.mock.calls[0] as unknown as [string, { timeoutMs: number }])[1];
      expect(timeoutMs).toBeGreaterThanOrEqual(5_000);
      expect(timeoutMs * 3).toBeLessThanOrEqual(budget);
    }
  });

  it("never runs for a private, demo or OpenRouter engine", async () => {
    for (const engine of ["open-weights", "openrouter", "demo-mock"] as const) {
      const markDamage = vi.fn(fakeDeps().markDamage);
      await runAgent(makeReport(), {
        engine,
        provider: { ...scriptedProvider(skipMarkTurns(ASSESSMENT_CARTON)), engine },
        deps: fakeDeps({ markDamage }),
        now: NOW,
      });
      expect(markDamage).not.toHaveBeenCalled();
    }
  });
});

async function fakeFiledDocument(c: CaseRecord) {
  void c;
  return { pdfPath: "data/runtime/claim.pdf", emailSubject: "Claim", emailBody: "Attached." };
}
