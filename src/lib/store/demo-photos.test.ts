import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sniffMime } from "../agent/photos";
import { loadDemoCases, missingDemoPhotos, provisionalDemoPhotos } from "./demo-cases";
import { isProvisionalDemoPhoto, resolveDemoPhoto } from "./demo-photos";

const PHOTOS_DIR = path.join(process.cwd(), "data", "photos");
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

describe("the photos of the six demo cases", () => {
  it("exist: a missing demo photo fails here, not in the middle of the video", () => {
    expect(missingDemoPhotos()).toEqual([]);
  });

  it("have the content their extension says (the stand-ins were WebP files named .jpg)", async () => {
    const images = (await readdir(PHOTOS_DIR)).filter((n) => path.extname(n).toLowerCase() in MIME_BY_EXT);
    expect(images.length).toBeGreaterThanOrEqual(6);
    for (const name of images) {
      const bytes = await readFile(path.join(PHOTOS_DIR, name));
      expect(sniffMime(bytes), name).toBe(MIME_BY_EXT[path.extname(name).toLowerCase()]);
    }
  });

  it("are declared honestly while they are provisional stand-ins and not photos taken by the team", async () => {
    // The hackathon wants photos taken by the team. As long as a case runs on a stand-in
    // (an AI-generated image, XMP trainedAlgorithmicMedia), the README must say so.
    const provisional = provisionalDemoPhotos();
    if (provisional.length > 0) {
      const readme = await readFile(path.join(PHOTOS_DIR, "README.md"), "utf8");
      expect(readme).toMatch(/AI-generated/);
      expect(readme).toMatch(/provisional/i);
    }
  });

  it("resolve to the same file for every demo case", () => {
    for (const c of loadDemoCases()) {
      for (const photo of c.report.photos) expect(resolveDemoPhoto(photo), photo).not.toBeNull();
    }
  });
});

describe("resolveDemoPhoto", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "dd-demo-photos-"));
    await mkdir(path.join(root, "data", "photos"), { recursive: true });
    await writeFile(path.join(root, "data", "photos", "a.webp"), "x");
    await writeFile(path.join(root, "data", "photos", "b.webp"), "x");
    await writeFile(path.join(root, "data", "photos", "b.jpg"), "x");
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("uses the stand-in only when the team's photo is not there", () => {
    expect(resolveDemoPhoto("data/photos/a.jpg", root)).toBe(path.join(root, "data/photos/a.webp"));
    expect(isProvisionalDemoPhoto(resolveDemoPhoto("data/photos/a.jpg", root)!)).toBe(true);
    expect(resolveDemoPhoto("data/photos/b.jpg", root)).toBe(path.join(root, "data/photos/b.jpg"));
    expect(isProvisionalDemoPhoto(resolveDemoPhoto("data/photos/b.jpg", root)!)).toBe(false);
    expect(resolveDemoPhoto("data/photos/c.jpg", root)).toBeNull();
  });
});
