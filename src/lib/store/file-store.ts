import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Env } from "../config";
import { runtimeDir } from "../runtime-dir";
import type { CaseRecord } from "../types";
import { newestFirst } from "./case-order";
import { createKeyedLock } from "./keyed-lock";

// One JSON file per case under <runtime dir>/cases/. No database to administer during the
// hackathon week; the files are git-ignored (data/runtime/) and readable by hand.

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/;

/** Case ids end up in file names and URLs: only a safe alphabet, no path separators. */
export function isSafeCaseId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** Directory holding the case files: <runtime dir>/cases (see src/lib/runtime-dir.ts). */
export function defaultCasesDir(env: Env = process.env): string {
  return path.join(runtimeDir(undefined, env), "cases");
}

export interface CaseStore {
  /** All cases, newest first (createdAt, then id). Unreadable files are skipped. */
  list(): Promise<CaseRecord[]>;
  /** null when the id is unknown or unsafe. Throws if the file exists but is corrupt. */
  get(id: string): Promise<CaseRecord | null>;
  /** Insert or replace. Atomic: readers never see a half-written file. */
  save(record: CaseRecord): Promise<CaseRecord>;
  /** Merge `patch` into the case and bump updatedAt. Throws if the id is unknown. */
  update(id: string, patch: Partial<Omit<CaseRecord, "id">>): Promise<CaseRecord>;
}

export interface CaseStoreOptions {
  dir: string;
  /** Clock for updatedAt (tests pin it). */
  now?: () => Date;
}

function isCaseRecord(value: unknown, expectedId: string): value is CaseRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { id?: unknown }).id === expectedId
  );
}

export function createCaseStore({ dir, now = () => new Date() }: CaseStoreOptions): CaseStore {
  // Serialise read-modify-write per case inside this process: two concurrent updates (the
  // agent finishing while the merchant clicks Approve) must not overwrite each other.
  const withLock = createKeyedLock();

  const fileOf = (id: string) => path.join(dir, `${id}.json`);

  async function read(id: string): Promise<CaseRecord | null> {
    let text: string;
    try {
      text = await fs.readFile(fileOf(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Case file ${id}.json is corrupt (invalid JSON)`);
    }
    if (!isCaseRecord(parsed, id)) throw new Error(`Case file ${id}.json is corrupt (id mismatch)`);
    return parsed;
  }

  async function write(record: CaseRecord): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    // Same directory as the target so rename() stays on one filesystem and is atomic.
    const tmp = path.join(dir, `.${record.id}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      await fs.rename(tmp, fileOf(record.id));
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  return {
    async list() {
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const records: CaseRecord[] = [];
      for (const name of names) {
        if (name.startsWith(".") || !name.endsWith(".json")) continue;
        const id = name.slice(0, -".json".length);
        if (!isSafeCaseId(id)) continue;
        try {
          const record = await read(id);
          if (record) records.push(record);
        } catch {
          // A single damaged file must not take the whole inbox down. Log the file name
          // only: case content holds (fictitious, but PII-shaped) customer data.
          console.warn(`[store] skipping unreadable case file ${name}`);
        }
      }
      return records.sort(newestFirst);
    },

    async get(id) {
      if (!isSafeCaseId(id)) return null;
      return read(id);
    },

    async save(record) {
      if (!isSafeCaseId(record.id)) throw new Error(`Invalid case id "${record.id}"`);
      return withLock(record.id, async () => {
        await write(record);
        return record;
      });
    },

    async update(id, patch) {
      if (!isSafeCaseId(id)) throw new Error(`Unknown case "${id}"`);
      return withLock(id, async () => {
        const existing = await read(id);
        if (!existing) throw new Error(`Unknown case "${id}"`);
        const defined = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined),
        );
        const merged: CaseRecord = {
          ...existing,
          ...defined,
          id: existing.id,
          updatedAt: now().toISOString(),
        };
        await write(merged);
        return merged;
      });
    },
  };
}
