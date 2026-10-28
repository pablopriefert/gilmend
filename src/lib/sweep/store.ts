import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Env } from "../config";
import { runtimeDir } from "../runtime-dir";
import { sharedObjects } from "../storage";
import type { SweepResult } from "./types";

// Where the latest sweep lives: the same choice as the cases (src/lib/storage/index.ts). With a
// shared object store (DAMAGE_DESK_STORAGE=blob) it is one JSON object, "sweep/latest.json", that
// every serverless instance and the cron see; without one it is a file under the runtime folder,
// replaced through a temp file and a rename so a reader never sees half of it. Only the LATEST
// sweep is kept: the plan is recomputed from the cases, and what is worth keeping from an earlier
// one (today's texts) is read from this one before it is replaced.

export const SWEEP_OBJECT_KEY = "sweep/latest.json";

function latestFile(env: Env): string {
  return path.join(runtimeDir(undefined, env), "sweep", "latest.json");
}

/** True when `value` has the shape of a stored sweep (a damaged file reads as "no sweep yet"). */
function isSweepResult(value: unknown): value is SweepResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<SweepResult>;
  return (
    v.version === 1 &&
    typeof v.generatedAt === "string" &&
    typeof v.day === "string" &&
    Array.isArray(v.items) &&
    typeof v.briefing === "object" &&
    v.briefing !== null &&
    typeof v.counts === "object" &&
    v.counts !== null
  );
}

function parse(text: string): SweepResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn("[gilmend] the stored sweep is not valid JSON: ignoring it");
    return null;
  }
  if (!isSweepResult(parsed)) {
    console.warn("[gilmend] the stored sweep has an unexpected shape: ignoring it");
    return null;
  }
  return parsed;
}

/** The latest stored sweep, or null when there is none (or it is unreadable). Throws on a storage failure. */
export async function loadLatestSweep(env: Env = process.env): Promise<SweepResult | null> {
  const objects = sharedObjects(env);
  if (objects) {
    const found = await objects.get(SWEEP_OBJECT_KEY);
    return found ? parse(found.bytes.toString("utf8")) : null;
  }
  try {
    return parse(await fs.readFile(latestFile(env), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Replace the latest sweep. Throws when it cannot be written. */
export async function saveLatestSweep(sweep: SweepResult, env: Env = process.env): Promise<void> {
  const body = `${JSON.stringify(sweep, null, 2)}\n`;
  const objects = sharedObjects(env);
  if (objects) {
    await objects.put(SWEEP_OBJECT_KEY, Buffer.from(body, "utf8"), { contentType: "application/json" });
    return;
  }
  const target = latestFile(env);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.latest.${process.pid}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
