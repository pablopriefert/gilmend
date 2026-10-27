import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCase, listCases, saveCase, updateCase } from "./cases";
import { createCaseStore, defaultCasesDir, isSafeCaseId } from "./file-store";
import { fauxCase } from "./faux-cases";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "damage-desk-store-test-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("createCaseStore", () => {
  it("round-trips a case through a JSON file", async () => {
    const store = createCaseStore({ dir: path.join(root, "cases") });
    const c = fauxCase({ id: "case-1" });
    await store.save(c);
    expect(await store.get("case-1")).toEqual(c);
    const onDisk = JSON.parse(await fs.readFile(path.join(root, "cases", "case-1.json"), "utf8"));
    expect(onDisk.id).toBe("case-1");
  });

  it("creates the directory on first write and lists nothing before that", async () => {
    const store = createCaseStore({ dir: path.join(root, "nested", "cases") });
    expect(await store.list()).toEqual([]);
    await store.save(fauxCase({ id: "a" }));
    expect(await store.list()).toHaveLength(1);
  });

  it("lists newest first, ties broken by id", async () => {
    const store = createCaseStore({ dir: root });
    await store.save(fauxCase({ id: "old", createdAt: "2026-10-28T08:00:00.000Z" }));
    await store.save(fauxCase({ id: "new", createdAt: "2026-10-30T08:00:00.000Z" }));
    await store.save(fauxCase({ id: "mid-b", createdAt: "2026-10-29T08:00:00.000Z" }));
    await store.save(fauxCase({ id: "mid-a", createdAt: "2026-10-29T08:00:00.000Z" }));
    expect((await store.list()).map((c) => c.id)).toEqual(["new", "mid-a", "mid-b", "old"]);
  });

  it("save replaces an existing case", async () => {
    const store = createCaseStore({ dir: root });
    await store.save(fauxCase({ id: "x", status: "new" }));
    await store.save(fauxCase({ id: "x", status: "approved" }));
    expect((await store.get("x"))?.status).toBe("approved");
    expect(await store.list()).toHaveLength(1);
  });

  it("writes atomically: no temp file is left behind", async () => {
    const store = createCaseStore({ dir: root });
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(fauxCase({ id: `c${i}` }))));
    const names = await fs.readdir(root);
    expect(names.filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(names).toHaveLength(20);
  });

  it("update merges the patch and bumps updatedAt, keeping the id", async () => {
    const store = createCaseStore({ dir: root, now: () => new Date("2026-11-01T09:00:00.000Z") });
    await store.save(fauxCase({ id: "u", status: "needs_review" }));
    const updated = await store.update("u", { status: "approved", id: "hijack" } as never);
    expect(updated.id).toBe("u");
    expect(updated.status).toBe("approved");
    expect(updated.updatedAt).toBe("2026-11-01T09:00:00.000Z");
    expect(updated.createdAt).toBe("2026-10-30T10:00:00.000Z");
    expect((await store.get("u"))?.status).toBe("approved");
  });

  it("update ignores undefined values in the patch", async () => {
    const store = createCaseStore({ dir: root });
    await store.save(fauxCase({ id: "u" }));
    const updated = await store.update("u", { status: undefined });
    expect(updated.status).toBe("needs_review");
  });

  it("update throws for an unknown id", async () => {
    const store = createCaseStore({ dir: root });
    await expect(store.update("ghost", { status: "approved" })).rejects.toThrow(/Unknown case/);
  });

  it("concurrent updates of the same case do not lose each other's changes", async () => {
    const store = createCaseStore({ dir: root });
    await store.save(fauxCase({ id: "race" }));
    await Promise.all([
      store.update("race", { status: "approved" }),
      store.update("race", { trace: [{ step: "Approved by merchant", at: "2026-10-30T10:00:00.000Z" }] }),
      store.update("race", { engine: "muse-spark-1.3" }),
    ]);
    const final = await store.get("race");
    expect(final?.status).toBe("approved");
    expect(final?.trace).toHaveLength(1);
    expect(final?.engine).toBe("muse-spark-1.3");
  });

  it("get returns null for unknown or unsafe ids (no path traversal)", async () => {
    const store = createCaseStore({ dir: path.join(root, "cases") });
    expect(await store.get("missing")).toBeNull();
    expect(await store.get("../secret")).toBeNull();
    expect(await store.get("a/b")).toBeNull();
    await expect(store.save(fauxCase({ id: "../evil" }))).rejects.toThrow(/Invalid case id/);
  });

  it("skips a corrupt file in the list but get reports it", async () => {
    const store = createCaseStore({ dir: root });
    await store.save(fauxCase({ id: "good" }));
    await fs.writeFile(path.join(root, "broken.json"), "{ not json", "utf8");
    expect((await store.list()).map((c) => c.id)).toEqual(["good"]);
    await expect(store.get("broken")).rejects.toThrow(/corrupt/);
  });

  it("ignores stray files in the directory", async () => {
    const store = createCaseStore({ dir: root });
    await fs.writeFile(path.join(root, ".hidden.json"), "{}", "utf8");
    await fs.writeFile(path.join(root, "notes.txt"), "hi", "utf8");
    expect(await store.list()).toEqual([]);
  });
});

describe("isSafeCaseId", () => {
  it("accepts slugs and rejects separators and dots", () => {
    expect(isSafeCaseId("demo-1-vase_broken")).toBe(true);
    expect(isSafeCaseId("..")).toBe(false);
    expect(isSafeCaseId("a.json")).toBe(false);
    expect(isSafeCaseId("")).toBe(false);
    expect(isSafeCaseId("a".repeat(200))).toBe(false);
  });
});

describe("defaultCasesDir", () => {
  it("honours DAMAGE_DESK_RUNTIME_DIR", () => {
    expect(defaultCasesDir({ DAMAGE_DESK_RUNTIME_DIR: "/x/y" })).toBe(path.join("/x/y", "cases"));
  });
  it("uses the OS temp dir on Vercel (read-only project directory)", () => {
    expect(defaultCasesDir({ VERCEL: "1" })).toBe(path.join(os.tmpdir(), "damage-desk", "cases"));
  });
  it("defaults to data/runtime/cases under the working directory", () => {
    expect(defaultCasesDir({})).toBe(path.join(process.cwd(), "data", "runtime", "cases"));
  });
});

describe("module-level functions (listCases, getCase, saveCase, updateCase)", () => {
  const previous = process.env.DAMAGE_DESK_RUNTIME_DIR;
  beforeEach(() => {
    process.env.DAMAGE_DESK_RUNTIME_DIR = root;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.DAMAGE_DESK_RUNTIME_DIR;
    else process.env.DAMAGE_DESK_RUNTIME_DIR = previous;
  });

  it("use the configured runtime directory", async () => {
    expect(await listCases()).toEqual([]);
    const saved = await saveCase(fauxCase({ id: "m1" }));
    expect(saved.id).toBe("m1");
    expect((await getCase("m1"))?.id).toBe("m1");
    expect((await updateCase("m1", { status: "rejected" })).status).toBe("rejected");
    expect((await listCases()).map((c) => c.id)).toEqual(["m1"]);
    await expect(fs.access(path.join(root, "cases", "m1.json"))).resolves.toBeUndefined();
  });
});
