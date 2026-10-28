import { describe, expect, it } from "vitest";
import { makeCase } from "@/components/fixtures";
import { photoSrc } from "@/components/photo-src";
import type { StreamEvent } from "@/lib/agent/events";
import type { CaseRecord } from "@/lib/types";
import { logicalPath, publicPhoto, scrubServerPaths, toPublicCase, toPublicStreamEvent } from "./public-case";

/** A case as a Vercel instance stores it: absolute paths in the OS temp folder. */
function vercelCase(): CaseRecord {
  const c = makeCase();
  return {
    ...c,
    report: { ...c.report, photos: ["/tmp/damage-desk/uploads/rpt-1/photo-1.jpg"] },
    evidence: [
      {
        photo: "/tmp/damage-desk/uploads/rpt-1/photo-1.jpg",
        annotatedPhoto: "/tmp/damage-desk/evidence/rpt-1/photo-1-annotated.png",
        method: "sam-3.1",
        note: "Outlined the shattered base.",
      },
    ],
    document: { ...c.document!, pdfPath: "/tmp/damage-desk/claims/case-1.pdf" },
    trace: [
      ...c.trace,
      {
        step: "Drafted the claim document",
        output: { ok: true, pdfPath: "/tmp/damage-desk/claims/case-1.pdf" },
        at: "2026-10-28T07:00:09.000Z",
      },
      {
        step: "Photo 2 could not be read",
        output: { error: "ENOENT: no such file or directory, open '/tmp/damage-desk/uploads/rpt-1/photo-2.jpg'" },
        at: "2026-10-28T07:00:10.000Z",
      },
    ],
  };
}

describe("toPublicCase: no server path leaves the server", () => {
  it("replaces every stored path of a Vercel case with an app reference", () => {
    const out = toPublicCase(vercelCase());
    expect(out.report.photos).toEqual(["/api/files?p=uploads%2Frpt-1%2Fphoto-1.jpg"]);
    expect(out.evidence[0].photo).toBe("/api/files?p=uploads%2Frpt-1%2Fphoto-1.jpg");
    expect(out.evidence[0].annotatedPhoto).toBe("/api/files?p=evidence%2Frpt-1%2Fphoto-1-annotated.png");
    expect(out.document?.pdfPath).toBe("/api/cases/case-1/pdf");
    const json = JSON.stringify(out);
    expect(json).not.toContain("/tmp/");
    expect(json).not.toContain("/damage-desk/");
  });

  it("scrubs a path quoted in the trace and keeps the logical path", () => {
    const out = toPublicCase(vercelCase());
    const quoted = JSON.stringify(out.trace);
    expect(quoted).toContain("claims/case-1.pdf");
    expect(quoted).toContain("open 'uploads/rpt-1/photo-2.jpg'");
    expect(quoted).not.toContain("/tmp");
  });

  it("maps a local case (data/runtime), a recorded run (data/showcase) and a demo photo", () => {
    const c = makeCase();
    const local = toPublicCase(c);
    expect(local.report.photos).toEqual(["/api/files?p=uploads%2Frpt-1%2Fphoto-1.jpg"]);
    expect(local.document?.pdfPath).toBe("/api/cases/case-1/pdf");

    const recorded = toPublicCase({
      ...c,
      evidence: [
        { photo: "data/showcase/photos/vase-broken.webp", annotatedPhoto: "data/showcase/evidence/x-annotated.jpg", method: "sam-3.1", note: "" },
      ],
      report: { ...c.report, photos: ["data/photos/vase-broken.webp"] },
    });
    expect(recorded.evidence[0].photo).toBe("/api/files?p=showcase%2Fphotos%2Fvase-broken.webp");
    expect(recorded.report.photos).toEqual(["/api/demo-photo?name=vase-broken"]);
  });

  it("keeps a data URL, an http address and a null outline as they are", () => {
    const c = makeCase();
    const out = toPublicCase({
      ...c,
      evidence: [{ photo: "data:image/png;base64,AAAA", annotatedPhoto: null, method: "none", note: "" }],
      report: { ...c.report, photos: ["https://example.com/p.jpg"] },
    });
    expect(out.evidence[0]).toMatchObject({ photo: "data:image/png;base64,AAAA", annotatedPhoto: null });
    expect(out.report.photos).toEqual(["https://example.com/p.jpg"]);
  });

  it("maps the photos of the replies and of the earlier rounds, and gives an earlier PDF its logical path", () => {
    const c = vercelCase();
    const out = toPublicCase({
      ...c,
      followUps: [
        { id: "fu-1", receivedAt: "2026-10-29T08:00:00.000Z", message: "Sharper photo", photos: ["/tmp/damage-desk/uploads/fu-1/photo-1.jpg"] },
      ],
      previousRounds: [
        {
          number: 1,
          status: "approved",
          order: c.order,
          assessment: c.assessment,
          claim: c.claim,
          decision: c.decision,
          evidence: c.evidence,
          document: c.document,
          engine: c.engine,
          finishedAt: "2026-10-29T08:00:00.000Z",
        },
      ],
    });
    expect(out.followUps?.[0].photos).toEqual(["/api/files?p=uploads%2Ffu-1%2Fphoto-1.jpg"]);
    expect(out.previousRounds?.[0].evidence[0].annotatedPhoto).toBe("/api/files?p=evidence%2Frpt-1%2Fphoto-1-annotated.png");
    expect(out.previousRounds?.[0].document?.pdfPath).toBe("claims/case-1.pdf");
    expect(JSON.stringify(out)).not.toContain("/tmp/");
  });

  it("is idempotent, and leaves a case without rounds without the optional keys", () => {
    const once = toPublicCase(vercelCase());
    expect(toPublicCase(once)).toEqual(once);
    expect("followUps" in once).toBe(false);
    expect("previousRounds" in once).toBe(false);
  });

  it("does not change what the UI loads: photoSrc of a mapped path is the same URL as before", () => {
    const c = vercelCase();
    const out = toPublicCase(c);
    expect(photoSrc(out.evidence[0].photo)).toBe(photoSrc(c.evidence[0].photo));
    expect(photoSrc(out.evidence[0].annotatedPhoto!)).toBe(photoSrc(c.evidence[0].annotatedPhoto!));
    expect(photoSrc(out.report.photos[0])).toBe(photoSrc(c.report.photos[0]));
  });

  it("does not touch the stored record", () => {
    const c = vercelCase();
    toPublicCase(c);
    expect(c.document?.pdfPath).toBe("/tmp/damage-desk/claims/case-1.pdf");
    expect(c.evidence[0].photo).toBe("/tmp/damage-desk/uploads/rpt-1/photo-1.jpg");
  });

  it("keeps customer text and money untouched", () => {
    const c = vercelCase();
    const out = toPublicCase(c);
    expect(out.report.message).toBe(c.report.message);
    expect(out.decision).toEqual(c.decision);
    expect(out.claim).toEqual(c.claim);
  });
});

describe("path helpers", () => {
  it("publicPhoto never returns an unknown absolute path", () => {
    expect(publicPhoto("/var/task/secret/x.jpg")).toBe("/api/files?p=x.jpg");
    expect(publicPhoto("")).toBe("");
  });

  it("logicalPath is relative to the runtime folder", () => {
    expect(logicalPath("/tmp/damage-desk/claims/a.pdf")).toBe("claims/a.pdf");
    expect(logicalPath("data/runtime/claims/a.pdf")).toBe("claims/a.pdf");
    expect(logicalPath("data/showcase/claims/a.pdf")).toBe("showcase/claims/a.pdf");
  });

  it("scrubServerPaths leaves an ordinary text alone", () => {
    expect(scrubServerPaths("Colissimo, 6 days left (up to 55/60)")).toBe("Colissimo, 6 days left (up to 55/60)");
  });
});

describe("toPublicStreamEvent", () => {
  it("turns the outline path of a mark_damage result into a URL, and leaves other events alone", () => {
    const event = {
      type: "tool_end",
      t: 10,
      tool: "mark_damage",
      turn: 1,
      calledBy: "model",
      ok: true,
      ms: 5,
      result: {
        tool: "mark_damage",
        photoIndex: 0,
        concepts: ["vase"],
        method: "sam-3.1",
        regions: 2,
        annotatedPath: "/tmp/damage-desk/evidence/rpt-1/photo-1-annotated.png",
        note: "",
      },
    } as StreamEvent;
    const out = toPublicStreamEvent(event);
    expect(out.type === "tool_end" && out.result?.tool === "mark_damage" && out.result.annotatedPath).toBe(
      "/api/files?p=evidence%2Frpt-1%2Fphoto-1-annotated.png",
    );
    const ping: StreamEvent = { type: "ping", t: 1 };
    expect(toPublicStreamEvent(ping)).toBe(ping);
  });
});
