import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { overrideSharedObjects } from "../storage";
import { createFauxObjectStore } from "../storage/faux-object-store";
import { runtimeDir } from "../runtime-dir";
import { runSweep } from "./run";
import { SWEEP_OBJECT_KEY, loadLatestSweep, saveLatestSweep } from "./store";
import { SWEEP_NOW, openCase } from "./plan-helpers";

afterEach(() => {
  overrideSharedObjects(undefined);
  vi.restoreAllMocks();
});

async function sample() {
  const { sweep } = await runSweep({
    trigger: "manual",
    now: SWEEP_NOW,
    env: {},
    cases: [openCase("1001", { deadlineHours: 20 })],
    store: { load: async () => null, save: async () => {} },
  });
  return sweep;
}

describe("the latest sweep, on local files", () => {
  it("is null before the first sweep", async () => {
    await fs.rm(path.join(runtimeDir(), "sweep"), { recursive: true, force: true });
    expect(await loadLatestSweep()).toBeNull();
  });

  it("is written and read back whole, replacing the earlier one", async () => {
    const first = await sample();
    await saveLatestSweep(first);
    expect(await loadLatestSweep()).toEqual(first);
    const second = { ...first, generatedAt: "2026-10-29T06:00:00.000Z", trigger: "cron" as const };
    await saveLatestSweep(second);
    expect((await loadLatestSweep())?.trigger).toBe("cron");
    // No temp file is left behind.
    const left = await fs.readdir(path.join(runtimeDir(), "sweep"));
    expect(left).toEqual(["latest.json"]);
  });

  it("reads a damaged file as 'no sweep yet' instead of failing the page", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = path.join(runtimeDir(), "sweep", "latest.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ not json");
    expect(await loadLatestSweep()).toBeNull();
    await fs.writeFile(file, JSON.stringify({ version: 2 }));
    expect(await loadLatestSweep()).toBeNull();
  });
});

describe("the latest sweep, on the shared object store", () => {
  it("is one JSON object under sweep/latest.json, read back from any instance", async () => {
    const objects = createFauxObjectStore();
    overrideSharedObjects(objects);
    expect(await loadLatestSweep()).toBeNull();
    const sweep = await sample();
    await saveLatestSweep(sweep);
    expect(objects.keys()).toEqual([SWEEP_OBJECT_KEY]);
    expect(await loadLatestSweep()).toEqual(sweep);
  });
});
