import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDemoCases } from "../store/demo-cases";
import { loadDemoPhotoHashes } from "./demo-photo-hashes";

afterEach(() => vi.restoreAllMocks());

const demoPhotoCount = () => loadDemoCases().reduce((n, d) => n + d.report.photos.length, 0);

describe("loadDemoPhotoHashes", () => {
  it("hashes every demo photo and stays silent when all of them are there", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hashes = await loadDemoPhotoHashes(path.join(process.cwd(), "."));
    expect(hashes).toHaveLength(demoPhotoCount());
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("[integrity]"));
  });

  it("warns once, without a path or customer data, when the photos are not shipped (review of 27 Oct 2026)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const empty = await mkdtemp(path.join(os.tmpdir(), "gilmend-no-photos-"));
    try {
      expect(await loadDemoPhotoHashes(empty)).toEqual([]);
      await loadDemoPhotoHashes(empty); // cached: no second line
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("[integrity]"));
      expect(lines).toEqual([`[integrity] hashed 0 of ${demoPhotoCount()} demo photos`]);
      expect(lines[0]).not.toContain(empty);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
