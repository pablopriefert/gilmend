import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getShowcaseCase, listShowcaseCases } from "../showcase/showcase";
import { createCaseStore } from "./file-store";
import { fauxCase } from "./faux-cases";
import { createLayeredCaseStore } from "./layered-store";
import type { CaseRecord } from "../types";

const REPO_SHOWCASE = path.join(process.cwd(), "data", "showcase");
const RECORDED = "real_demo-1-vase-broken";

let scratch: string;
let showcase: string;

async function fingerprint(dir: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(d: string): Promise<void> {
    for (const entry of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else hash.update(path.relative(dir, full)).update(await readFile(full));
    }
  }
  await walk(dir);
  return hash.digest("hex");
}

function layered(now = () => new Date("2026-11-01T09:00:00.000Z")) {
  const base = createCaseStore({ dir: path.join(scratch, "cases") });
  const store = createLayeredCaseStore({
    base,
    showcase: { list: () => listShowcaseCases(), get: (id) => getShowcaseCase(id) },
    now,
  });
  return { base, store };
}

beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "dd-layered-"));
  // A private copy of the showcase, so a test can prove that nothing wrote to it.
  showcase = path.join(scratch, "showcase");
  await cp(REPO_SHOWCASE, showcase, { recursive: true });
  vi.stubEnv("DAMAGE_DESK_SHOWCASE_DIR", showcase);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe("layered case store: the recorded runs under a writable store", () => {
  it("lists stored cases and recorded runs together, newest first", async () => {
    const { store } = layered();
    await store.save(fauxCase({ id: "mine", createdAt: "2026-11-02T10:00:00.000Z" }));
    const ids = (await store.list()).map((c) => c.id);
    expect(ids).toHaveLength(7);
    expect(ids[0]).toBe("mine");
    expect(ids).toContain(RECORDED);
  });

  it("gets a recorded run, a stored case, and null for the rest", async () => {
    const { store } = layered();
    await store.save(fauxCase({ id: "mine" }));
    expect((await store.get(RECORDED))?.recorded?.recordedOn).toBe("2026-10-27");
    expect((await store.get("mine"))?.id).toBe("mine");
    expect(await store.get("ghost")).toBeNull();
    expect(await store.get("../x")).toBeNull();
  });

  it("a stored case with the id of a recording shadows it, in the list and by id", async () => {
    const { store } = layered();
    await store.save({ ...fauxCase({ id: RECORDED, status: "approved" }), engine: "muse-spark-1.3" });
    expect((await store.get(RECORDED))?.status).toBe("approved");
    const ids = (await store.list()).map((c) => c.id);
    expect(ids.filter((id) => id === RECORDED)).toHaveLength(1);
    expect(ids).toHaveLength(6);
  });

  it("the first change to a recorded run stores a copy, and the committed files do not change", async () => {
    const { base, store } = layered();
    const before = await fingerprint(showcase);
    expect(await base.get(RECORDED)).toBeNull();

    const patched = await store.update(RECORDED, {
      status: "approved",
      trace: [{ step: "Merchant approved the case. Ready to send; nothing was sent.", at: "2026-11-01T09:00:00.000Z" }],
    });

    expect(patched.status).toBe("approved");
    expect(patched.id).toBe(RECORDED);
    expect(patched.updatedAt).toBe("2026-11-01T09:00:00.000Z");
    // Still the recording of a real run, with the merchant's action on top.
    expect(patched.recorded).toEqual({ recordedOn: "2026-10-27" });
    expect(patched.engine).toBe("muse-spark-1.3");
    expect(patched.decision?.decision).toBe("reship");
    expect((await base.get(RECORDED))?.status).toBe("approved");
    expect((await store.get(RECORDED))?.status).toBe("approved");
    expect(await fingerprint(showcase)).toBe(before);
    expect(await getShowcaseCase(RECORDED)).toMatchObject({ status: "needs_review" });
  });

  it("later changes go to the copy, and two quick changes keep both their fields and their trace lines", async () => {
    const { store } = layered();
    const before = ((await store.get(RECORDED)) as CaseRecord).trace.length;
    // The first change copies the recording; the second must land on the copy, not on a second one.
    await Promise.all([
      store.update(RECORDED, { status: "approved" }, { appendTrace: [{ step: "Merchant approved.", at: "2026-11-01T09:00:00.000Z" }] }),
      store.update(RECORDED, {}, { appendTrace: [{ step: "Merchant edited the customer reply.", at: "2026-11-01T09:00:01.000Z" }] }),
    ]);
    const final = (await store.get(RECORDED)) as CaseRecord;
    expect(final.status).toBe("approved");
    expect(final.trace).toHaveLength(before + 2);
    expect(final.trace.slice(before).map((t) => t.step).sort()).toEqual(["Merchant approved.", "Merchant edited the customer reply."]);
    await store.update(RECORDED, { status: "rejected" });
    expect((await store.get(RECORDED))?.status).toBe("rejected");
  });

  it("update ignores undefined values, and an unknown or unsafe id throws", async () => {
    const { store } = layered();
    const updated = await store.update(RECORDED, { status: undefined });
    expect(updated.status).toBe("needs_review");
    await expect(store.update("ghost", { status: "approved" })).rejects.toThrow(/Unknown case/);
    await expect(store.update("../x", { status: "approved" })).rejects.toThrow(/Unknown case/);
  });

  it("is a plain writable store when there is no showcase", async () => {
    vi.stubEnv("DAMAGE_DESK_SHOWCASE_DIR", path.join(scratch, "none"));
    const { store } = layered();
    expect(await store.list()).toEqual([]);
    await store.save(fauxCase({ id: "a" }));
    expect((await store.list()).map((c) => c.id)).toEqual(["a"]);
    await expect(store.update(RECORDED, { status: "approved" })).rejects.toThrow(/Unknown case/);
  });
});
