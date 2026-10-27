import { describe, expect, it } from "vitest";
import { summarizeCases } from "@/lib/store/summary";
import { isStaleSource, noteVerification, prettyJson, sanitizeForDisplay } from "./display-data";
import { describeEngine } from "@/lib/config";
import { detailFor, effectiveEngine, engineOptions } from "./engine-choice";
import { NOW, makeCase } from "./fixtures";
import { deadlineInfo, formatDate, formatEur } from "./format";
import { photoSrc } from "./photo-src";
import { detectLanguage } from "@/app/api/_lib/language";

const claimCase = (id: string, over: { max?: number; deadline?: string; created?: string; status?: "needs_review" | "rejected" | "approved"; eligible?: boolean; carrierClaim?: boolean }) => {
  const base = makeCase();
  return makeCase({
    id,
    status: over.status ?? "needs_review",
    createdAt: over.created ?? "2026-10-28T07:00:00.000Z",
    claim: {
      ...base.claim!,
      eligible: over.eligible ?? true,
      maxCompensationEur: over.max ?? 100,
      claimDeadline: over.deadline ?? "2026-11-02T16:00:00.000Z",
    },
    decision: { ...base.decision!, carrierClaim: over.carrierClaim ?? true },
  });
};

describe("summarizeCases (header counter)", () => {
  it("adds up open claims of this month and counts the ones due within 7 days", () => {
    const summary = summarizeCases(
      [
        claimCase("a", { max: 55.2, deadline: "2026-10-30T10:00:00.000Z" }), // due this week
        claimCase("b", { max: 690, deadline: "2026-11-20T10:00:00.000Z" }), // later
        claimCase("c", { max: 25, deadline: "2026-11-04T09:00:00.000Z" }), // < 7 days
      ],
      NOW,
    );
    expect(summary.recoverableThisMonthEur).toBeCloseTo(770.2);
    expect(summary.claimsDueThisWeek).toBe(2);
  });

  it("ignores rejected, ineligible, no-claim, expired and last-month cases for the money", () => {
    const summary = summarizeCases(
      [
        claimCase("rejected", { status: "rejected" }),
        claimCase("ineligible", { eligible: false }),
        claimCase("noclaim", { carrierClaim: false }),
        claimCase("expired", { deadline: "2026-10-27T10:00:00.000Z" }),
        claimCase("old", { created: "2026-09-20T10:00:00.000Z", max: 300 }),
      ],
      NOW,
    );
    expect(summary.recoverableThisMonthEur).toBe(0);
    // The September case is still an open claim due within a week, so it still counts as due.
    expect(summary.claimsDueThisWeek).toBe(1);
  });

  it("keeps approved claims in the total", () => {
    expect(summarizeCases([claimCase("ok", { status: "approved", max: 40 })], NOW).recoverableThisMonthEur).toBe(40);
  });
});

describe("formatting", () => {
  it("formats euros the way the counter shows them", () => {
    expect(formatEur(1240, { whole: true })).toBe("€1,240");
    expect(formatEur(55.2)).toBe("€55.20");
    expect(formatEur(690)).toBe("€690");
  });

  it("formats dates in Paris time, independent of the machine", () => {
    expect(formatDate("2026-10-28T23:30:00.000Z")).toBe("29 Oct 2026");
    expect(formatDate("garbage")).toBe("unknown date");
  });

  it("computes the deadline label from now, not from the stale daysLeft", () => {
    const claim = (d: string) => ({ eligible: true, claimDeadline: d });
    expect(deadlineInfo(claim("2026-10-27T10:00:00.000Z"), NOW)).toEqual({ text: "Overdue", tone: "overdue" });
    expect(deadlineInfo(claim("2026-10-28T18:00:00.000Z"), NOW)).toEqual({ text: "1 day left", tone: "soon" });
    expect(deadlineInfo(claim("2026-11-10T10:00:00.000Z"), NOW)).toEqual({ text: "13 days left", tone: "ok" });
    expect(deadlineInfo({ eligible: false, claimDeadline: null }, NOW).tone).toBe("none");
    expect(deadlineInfo(null, NOW).tone).toBe("none");
  });
});

describe("photoSrc", () => {
  it("serves runtime files through /api/files, whatever shape the stored path has", () => {
    expect(photoSrc("data/runtime/uploads/r1/photo-1.jpg")).toBe("/api/files?p=uploads%2Fr1%2Fphoto-1.jpg");
    expect(photoSrc("/Users/me/damage-desk/data/runtime/evidence/a b.png")).toBe(
      "/api/files?p=evidence%2Fa%20b.png",
    );
  });

  it("serves the files a Vercel instance wrote under the OS temp dir through /api/files too", () => {
    expect(photoSrc("/tmp/damage-desk/uploads/r1/photo-1.png")).toBe("/api/files?p=uploads%2Fr1%2Fphoto-1.png");
    expect(photoSrc("/var/folders/ab/T/damage-desk/evidence/x-annotated.jpg")).toBe(
      "/api/files?p=evidence%2Fx-annotated.jpg",
    );
    // Only the runtime subfolders: anything else stays a public asset path.
    expect(photoSrc("/damage-desk/logo.png")).toBe("/damage-desk/logo.png");
  });

  it("keeps data URLs and public assets, and drops anything else", () => {
    expect(photoSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(photoSrc("data:text/html;base64,AAAA")).toBe("");
    expect(photoSrc("public/demo/x.png")).toBe("/demo/x.png");
    expect(photoSrc("/demo/x.png")).toBe("/demo/x.png");
    expect(photoSrc("javascript:alert(1)")).toBe("");
    expect(photoSrc("")).toBe("");
  });
});

describe("display data", () => {
  it("shortens long strings such as data URLs and keeps the shape of objects", () => {
    const big = `data:image/png;base64,${"A".repeat(5000)}`;
    const out = sanitizeForDisplay({ photo: big, list: Array.from({ length: 40 }, (_, i) => i) }) as {
      photo: string;
      list: unknown[];
    };
    expect(out.photo.length).toBeLessThan(100);
    expect(out.photo).toMatch(/5022 characters/);
    expect(out.list).toHaveLength(26);
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("does not crash on circular data", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(prettyJson(loop)).toContain("nested too deep");
  });

  it("flags unverified and dated-source notes and strips the tag", () => {
    expect(noteVerification("[D] deduced by us")).toEqual({ text: "Deduced by us", flag: "unverified" });
    expect(noteVerification("[NP] not public")).toEqual({ text: "Not public", flag: "unverified" });
    expect(noteVerification("UNVERIFIED: check the contract")).toEqual({
      text: "Check the contract",
      flag: "unverified",
    });
    expect(noteVerification("DATED SOURCE: the amounts come from the 2020 edition")).toEqual({
      text: "The amounts come from the 2020 edition",
      flag: "dated_source",
    });
    expect(noteVerification("Figures are public terms. UNVERIFIED for this service.").flag).toBe("unverified");
    expect(noteVerification("Insurance is extra")).toEqual({ text: "Insurance is extra", flag: null });
  });

  it("calls a source stale after 60 days", () => {
    expect(isStaleSource("2026-10-22", NOW)).toBe(false);
    expect(isStaleSource("2026-01-02", NOW)).toBe(true);
    expect(isStaleSource("not a date", NOW)).toBe(true);
  });
});

describe("engine choice", () => {
  it("falls back to demo mode exactly like the server does", () => {
    const none = { museKey: false, openWeights: false };
    expect(effectiveEngine("muse-spark-1.3", none)).toBe("demo-mock");
    expect(effectiveEngine("open-weights", none)).toBe("demo-mock");
    expect(effectiveEngine("demo-mock", { museKey: true, openWeights: true })).toBe("demo-mock");
    expect(effectiveEngine("muse-spark-1.3", { museKey: true, openWeights: false })).toBe("muse-spark-1.3");
    expect(effectiveEngine("open-weights", { museKey: false, openWeights: true })).toBe("open-weights");
  });

  it("says so honestly when an engine is not configured", () => {
    const [muse, open, demo] = engineOptions({ museKey: false, openWeights: false });
    expect(muse.label).toBe("Muse Spark 1.3 (Model API)");
    expect(muse.description).toMatch(/runs in demo mode/);
    expect(open.label).toBe("Run privately (open weights)");
    expect(open.description).toMatch(/runs in demo mode/);
    expect(demo.description).toMatch(/Not Muse/);
  });
});

describe("engine choice: Baseten and the OpenRouter test engine", () => {
  const baseten = describeEngine("open-weights", { OPEN_WEIGHTS_PROVIDER: "baseten", BASETEN_API_KEY: "placeholder" });
  const availability = { museKey: true, openWeights: true, openWeightsDetail: baseten };

  it("says plainly where the photos go on a Baseten run: private from Meta's API is not on your hardware", () => {
    const open = engineOptions(availability).find((o) => o.value === "open-weights")!;
    expect(open.description).toMatch(/Muse Spark Open \(open weights, served by Baseten\)/);
    expect(open.description).toMatch(/nothing goes to the Meta Model API/);
    expect(open.description).toMatch(/not your own hardware/);
    expect(open.description).toMatch(/go to Baseten/);
  });

  it("describes the Modal and custom hosts for what they are", () => {
    const modal = describeEngine("open-weights", { OPEN_WEIGHTS_BASE_URL: "https://w--g.modal.run/v1", OPEN_WEIGHTS_MODEL: "muse-glimmer" });
    expect(engineOptions({ museKey: false, openWeights: true, openWeightsDetail: modal })[1].description).toMatch(
      /Muse Glimmer \(open weights, served by Modal\).*Modal deployment/,
    );
  });

  it("hands the page the model and host of the engine it will run as", () => {
    expect(detailFor("open-weights", availability)).toBe(baseten);
    expect(detailFor("muse-spark-1.3", availability)).toBeUndefined();
  });

  it("offers the OpenRouter test engine only when its key is set, last before demo mode, never as the default", () => {
    expect(engineOptions({ museKey: true, openWeights: false }).map((o) => o.value)).toEqual([
      "muse-spark-1.3",
      "open-weights",
      "demo-mock",
    ]);
    const options = engineOptions({ museKey: true, openWeights: false, openRouter: true });
    expect(options.map((o) => o.value)).toEqual(["muse-spark-1.3", "open-weights", "openrouter", "demo-mock"]);
    expect(options[2].description).toMatch(/Not private/);
    expect(effectiveEngine("openrouter", { museKey: true, openWeights: false })).toBe("demo-mock");
    expect(effectiveEngine("openrouter", { museKey: true, openWeights: false, openRouter: true })).toBe("openrouter");
  });
});

describe("detectLanguage", () => {
  it("tells French from English", () => {
    expect(detectLanguage("Bonjour, mon colis est arrivé ouvert, il manque un article.")).toBe("fr");
    expect(detectLanguage("Hi, my vase arrived broken this morning.")).toBe("en");
    expect(detectLanguage("???")).toBe("en");
  });
});
