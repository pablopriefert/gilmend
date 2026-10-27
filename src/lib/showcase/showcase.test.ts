import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getShowcaseCase, listShowcaseCases, resolveShowcaseFile, showcaseDir } from "./showcase";

const REPO_SHOWCASE = path.join(process.cwd(), "data", "showcase");
let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "dd-showcase-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(scratch, { recursive: true, force: true });
});

describe("the committed showcase (data/showcase)", () => {
  beforeEach(() => vi.stubEnv("DAMAGE_DESK_SHOWCASE_DIR", REPO_SHOWCASE));

  it("lists the six recorded real runs, newest first", async () => {
    const cases = await listShowcaseCases();
    expect(cases.map((c) => c.id).sort()).toEqual([
      "real_demo-1-vase-broken",
      "real_demo-2-carton-crushed",
      "real_demo-3-photo-blurry",
      "real_demo-4-opened-missing",
      "real_demo-5-expensive-escalation",
      "real_demo-6-late-report",
    ]);
    for (const c of cases) {
      expect(c.engine).toBe("muse-spark-1.3");
      expect(c.recorded).toEqual({ recordedOn: "2026-10-27" });
      expect(c.status).toBe("needs_review");
    }
    const created = cases.map((c) => c.createdAt);
    expect(created).toEqual([...created].sort().reverse());
  });

  it("gets one case by id, and null for an unknown or unsafe id", async () => {
    expect((await getShowcaseCase("real_demo-1-vase-broken"))?.decision?.decision).toBe("reship");
    expect(await getShowcaseCase("real_demo-9-nothing")).toBeNull();
    expect(await getShowcaseCase("../package")).toBeNull();
    expect(await getShowcaseCase("a/b")).toBeNull();
  });

  it("serves the files of a recorded case from data/showcase, by either spelling of the path", async () => {
    const c = (await getShowcaseCase("real_demo-1-vase-broken"))!;
    const annotated = c.evidence[0].annotatedPhoto!;
    expect(annotated).toMatch(/^data\/showcase\/evidence\/.+-annotated\.jpg$/);
    const real = await resolveShowcaseFile(annotated);
    expect(real).toBe(path.join(await realpath(REPO_SHOWCASE), annotated.slice("data/showcase/".length)));
    expect(await resolveShowcaseFile(annotated.replace("data/showcase/", "showcase/"))).toBe(real);
    // The vase run ended without a carrier claim, so the PDF is checked on the opened parcel.
    const claimed = (await getShowcaseCase("real_demo-4-opened-missing"))!;
    expect(await resolveShowcaseFile(claimed.document!.pdfPath)).toMatch(/claims\/real_demo-4-opened-missing\.pdf$/);
    expect(await resolveShowcaseFile(c.report.photos[0])).toMatch(/photos\/vase-broken\.webp$/);
  });

  it("never leaves the showcase folder: traversal, absolute paths and NUL are refused", async () => {
    expect(await resolveShowcaseFile("data/showcase/../../package.json")).toBeNull();
    expect(await resolveShowcaseFile("showcase/cases/../../../package.json")).toBeNull();
    expect(await resolveShowcaseFile(path.join(REPO_SHOWCASE, "cases", "real_demo-1-vase-broken.json"))).toBeNull();
    expect(await resolveShowcaseFile("data/showcase/photos/vase-broken.webp\0.png")).toBeNull();
    expect(await resolveShowcaseFile("data/runtime/evidence/x.jpg")).toBeNull();
    expect(await resolveShowcaseFile("")).toBeNull();
    expect(await resolveShowcaseFile("showcase/photos/missing.webp")).toBeNull();
  });
});

describe("showcaseDir and a missing or odd folder", () => {
  it("defaults to data/showcase and honours DAMAGE_DESK_SHOWCASE_DIR", () => {
    expect(showcaseDir({})).toBe(REPO_SHOWCASE);
    expect(showcaseDir({ DAMAGE_DESK_SHOWCASE_DIR: "/x/y" })).toBe("/x/y");
  });

  it("is empty, not an error, when the folder does not exist", async () => {
    vi.stubEnv("DAMAGE_DESK_SHOWCASE_DIR", path.join(scratch, "nope"));
    expect(await listShowcaseCases()).toEqual([]);
    expect(await getShowcaseCase("real_demo-1-vase-broken")).toBeNull();
    expect(await resolveShowcaseFile("data/showcase/photos/vase-broken.webp")).toBeNull();
  });

  it("only treats a JSON file with a `recorded` marker and a matching id as a showcase case", async () => {
    vi.stubEnv("DAMAGE_DESK_SHOWCASE_DIR", scratch);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await mkdir(path.join(scratch, "cases"));
    const base = { engine: "muse-spark-1.3", createdAt: "2026-10-27T10:00:00.000Z" };
    await writeFile(path.join(scratch, "cases", "ok.json"), JSON.stringify({ ...base, id: "ok", recorded: { recordedOn: "2026-10-27" } }));
    await writeFile(path.join(scratch, "cases", "plain.json"), JSON.stringify({ ...base, id: "plain" }));
    await writeFile(path.join(scratch, "cases", "mismatch.json"), JSON.stringify({ ...base, id: "other", recorded: { recordedOn: "2026-10-27" } }));
    await writeFile(path.join(scratch, "cases", "broken.json"), "{ not json");
    await writeFile(path.join(scratch, "cases", ".hidden.json"), "{}");
    await writeFile(path.join(scratch, "cases", "notes.txt"), "hi");
    expect((await listShowcaseCases()).map((c) => c.id)).toEqual(["ok"]);
    expect(await getShowcaseCase("plain")).toBeNull();
    expect(await getShowcaseCase("broken")).toBeNull();
  });

  it("does not follow a symlink out of the folder", async () => {
    vi.stubEnv("DAMAGE_DESK_SHOWCASE_DIR", path.join(scratch, "showcase"));
    await mkdir(path.join(scratch, "showcase", "photos"), { recursive: true });
    await writeFile(path.join(scratch, "secret.png"), "secret");
    await symlink(path.join(scratch, "secret.png"), path.join(scratch, "showcase", "photos", "link.png"));
    expect(await resolveShowcaseFile("data/showcase/photos/link.png")).toBeNull();
  });
});
