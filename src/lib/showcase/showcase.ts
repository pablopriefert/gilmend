import { promises as fs } from "node:fs";
import path from "node:path";
import type { Env } from "../config";
import { newestFirst } from "../store/case-order";
import { isSafeCaseId } from "../store/file-store";
import type { CaseRecord } from "../types";

// The showcase: real runs of Muse Spark 1.3 + SAM 3.1 (Meta Model API) that were recorded
// once, on 27 Oct 2026, and are committed under data/showcase/ so that a fresh deployment
// (or a fresh clone) is not an empty inbox. They are READ-ONLY here: nothing in this file
// writes. A merchant action on one of them is stored as a copy by the layered store
// (src/lib/store/layered-store.ts) and the committed files never change.
//
//   data/showcase/cases/<id>.json     the case, with `recorded: { recordedOn }`
//   data/showcase/photos/*.webp       the photos Muse was shown (provisional stand-ins,
//                                     see data/photos/README.md)
//   data/showcase/evidence/*.jpg      the photos annotated by SAM 3.1
//   data/showcase/claims/*.pdf        the claim PDFs
//
// The cases refer to their files by the logical path "data/showcase/..." whatever the
// machine, and resolveShowcaseFile maps that to the real folder.

/** Logical prefix of a showcase file in a case ("data/showcase/evidence/x.jpg"). */
export const SHOWCASE_PATH_PREFIX = "data/showcase/";

/**
 * Folder of the showcase. DAMAGE_DESK_SHOWCASE_DIR overrides it: the test setup points it at
 * a folder that does not exist (so tests see no showcase), and the showcase tests point it at
 * a fixture. A missing folder simply means "no showcase".
 */
export function showcaseDir(env: Env = process.env): string {
  return env.DAMAGE_DESK_SHOWCASE_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "showcase");
}

function isRecordedCase(value: unknown, expectedId: string): value is CaseRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { id?: unknown; recorded?: { recordedOn?: unknown } };
  // `recorded` is what makes a JSON file a showcase case: a stray file without it is ignored.
  return v.id === expectedId && typeof v.recorded?.recordedOn === "string";
}

async function readShowcaseCase(dir: string, id: string): Promise<CaseRecord | null> {
  let text: string;
  try {
    text = await fs.readFile(path.join(/*turbopackIgnore: true*/ dir, "cases", `${id}.json`), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn(`[showcase] skipping unreadable showcase file ${id}.json`);
    return null;
  }
  if (!isRecordedCase(parsed, id)) {
    console.warn(`[showcase] skipping ${id}.json: not a recorded case with a matching id`);
    return null;
  }
  return parsed;
}

/** Every recorded case, newest first. Unreadable files are skipped (name logged, not content). */
export async function listShowcaseCases(env: Env = process.env): Promise<CaseRecord[]> {
  const dir = showcaseDir(env);
  let names: string[];
  try {
    names = await fs.readdir(path.join(/*turbopackIgnore: true*/ dir, "cases"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const records: CaseRecord[] = [];
  for (const name of names) {
    if (name.startsWith(".") || !name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    if (!isSafeCaseId(id)) continue;
    const record = await readShowcaseCase(dir, id);
    if (record) records.push(record);
  }
  return records.sort(newestFirst);
}

/** One recorded case, or null for an unknown or unsafe id. */
export async function getShowcaseCase(id: string, env: Env = process.env): Promise<CaseRecord | null> {
  if (!isSafeCaseId(id)) return null;
  return readShowcaseCase(showcaseDir(env), id);
}

// "data/showcase/<rel>" (as stored in a case) or "showcase/<rel>" (as /api/files asks for it).
const SHOWCASE_REQUEST = /^(?:\.\/)?(?:data\/)?showcase\/(.+)$/;

/**
 * The real file behind a showcase path, or null. Only files inside the showcase folder:
 * `realpath` makes a ".." or a symlink unable to point outside, and a missing file is null.
 */
export async function resolveShowcaseFile(requested: string, env: Env = process.env): Promise<string | null> {
  if (requested === "" || requested.includes("\0")) return null;
  const match = SHOWCASE_REQUEST.exec(requested.replaceAll("\\", "/"));
  if (!match) return null;
  try {
    const root = await fs.realpath(/*turbopackIgnore: true*/ showcaseDir(env));
    const real = await fs.realpath(path.resolve(/*turbopackIgnore: true*/ root, match[1]));
    if (real.startsWith(root + path.sep) && (await fs.stat(real)).isFile()) return real;
  } catch {
    // missing folder or file: not part of the showcase
  }
  return null;
}
