import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRuntimeFile } from "../app/api/_lib/runtime-files";
import { runtimeDir, safeFileStem, toStoredPath } from "./runtime-dir";
import { runtimeDir as evidenceRuntimeDir } from "./evidence/runtime-dir";
import { defaultCasesDir } from "./store/file-store";
import { buildClaimDocument } from "./documents/claim-pdf";
import { sampleCase } from "./documents/test-helpers";

describe("runtimeDir: one rule for uploads, cases, PDFs and evidence", () => {
  it("is <cwd>/data/runtime by default", () => {
    expect(runtimeDir(undefined, {})).toBe(path.join(process.cwd(), "data", "runtime"));
  });

  it("is the OS temp dir on Vercel, where the project folder is read-only", () => {
    expect(runtimeDir(undefined, { VERCEL: "1" })).toBe(path.join(os.tmpdir(), "damage-desk"));
  });

  it("lets DAMAGE_DESK_RUNTIME_DIR and an explicit override win, in that order", () => {
    expect(runtimeDir(undefined, { VERCEL: "1", DAMAGE_DESK_RUNTIME_DIR: "/srv/dd" })).toBe("/srv/dd");
    expect(runtimeDir("/explicit", { DAMAGE_DESK_RUNTIME_DIR: "/srv/dd" })).toBe("/explicit");
  });

  it("is the same function for the evidence and document modules", () => {
    expect(evidenceRuntimeDir).toBe(runtimeDir);
  });

  it("makes the case store follow it", () => {
    expect(defaultCasesDir({ VERCEL: "1" })).toBe(path.join(os.tmpdir(), "damage-desk", "cases"));
    expect(defaultCasesDir({ DAMAGE_DESK_RUNTIME_DIR: "/srv/dd" })).toBe(path.join("/srv/dd", "cases"));
  });

  it("keeps helpers for stored paths and file stems", () => {
    expect(toStoredPath(path.join(process.cwd(), "data", "runtime", "x.pdf"))).toBe(path.join("data", "runtime", "x.pdf"));
    expect(toStoredPath("/somewhere/else/x.pdf")).toBe("/somewhere/else/x.pdf");
    expect(safeFileStem("../../x")).toBe(".._.._x".replace(/\./g, "_"));
  });
});

describe("on Vercel, a PDF written by the claim builder is readable by the file routes", () => {
  let tmpRoot: string;
  beforeEach(async () => {
    // Stand-in for os.tmpdir()/damage-desk, so the test never writes to the real temp dir.
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "dd-vercel-"));
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DAMAGE_DESK_RUNTIME_DIR", tmpRoot);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("writes the PDF under the runtime dir (not under <cwd>/data/runtime) and resolves it back", async () => {
    const doc = await buildClaimDocument(sampleCase({ id: "case-vercel" }), { env: {} });
    const written = path.resolve(doc.pdfPath);
    expect(written.startsWith(tmpRoot + path.sep)).toBe(true);
    const resolved = await resolveRuntimeFile(doc.pdfPath);
    expect(resolved).not.toBeNull();
    expect((await readFile(resolved!)).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("resolveRuntimeFile still refuses files outside the runtime dir", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "dd-outside-"));
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "x.txt"), "x");
    expect(await resolveRuntimeFile(path.join(outside, "x.txt"))).toBeNull();
    await rm(outside, { recursive: true, force: true });
  });
});
