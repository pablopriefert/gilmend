import type { CaseRecord } from "../types";
import { PreconditionFailedError, type ObjectStore } from "../storage/object-store";
import { newestFirst } from "./case-order";
import { isSafeCaseId, type CaseStore } from "./file-store";
import { createKeyedLock } from "./keyed-lock";

// A CaseStore on top of a shared ObjectStore (src/lib/storage/object-store.ts): one JSON
// object per case under "cases/". Same contract as the file store, with these guarantees
// spelled out for a store that several serverless instances share:
//
//  - Ids are validated (isSafeCaseId) before they become part of a key.
//  - save() is ONE put: the object is replaced atomically, so a reader gets the old or the
//    new case, never half of one. Two instances saving the same id: the last put wins.
//  - update() is a read-modify-write. Inside one instance the keyed lock serialises it (as in
//    the file store). Across instances the lock does not exist, so when the backend supports
//    conditional writes the put carries the ETag that was read and a conflict re-reads and
//    re-applies the patch (up to MAX_ATTEMPTS). Without conditional writes it is
//    last-writer-wins, which is what the README states for the demo.
//  - list() is one list call plus one get per case (no index object to keep consistent).
//    Fine for a demo's dozens of cases, not for thousands.

const CASES_PREFIX = "cases/";
const MAX_ATTEMPTS = 5;
const LIST_CONCURRENCY = 8;

export interface ObjectCaseStoreOptions {
  objects: ObjectStore;
  /** Clock for updatedAt (tests pin it). */
  now?: () => Date;
}

function isCaseRecord(value: unknown, expectedId: string): value is CaseRecord {
  return typeof value === "object" && value !== null && (value as { id?: unknown }).id === expectedId;
}

export function createObjectCaseStore({ objects, now = () => new Date() }: ObjectCaseStoreOptions): CaseStore {
  const withLock = createKeyedLock();
  const keyOf = (id: string) => `${CASES_PREFIX}${id}.json`;

  async function read(id: string): Promise<{ record: CaseRecord; etag?: string } | null> {
    const found = await objects.get(keyOf(id));
    if (!found) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(found.bytes.toString("utf8"));
    } catch {
      throw new Error(`Case object ${id}.json is corrupt (invalid JSON)`);
    }
    if (!isCaseRecord(parsed, id)) throw new Error(`Case object ${id}.json is corrupt (id mismatch)`);
    return { record: parsed, etag: found.etag };
  }

  async function write(record: CaseRecord, ifMatch?: string): Promise<void> {
    await objects.put(keyOf(record.id), Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8"), {
      contentType: "application/json",
      ...(ifMatch !== undefined ? { ifMatch } : {}),
    });
  }

  return {
    async list() {
      const ids = (await objects.list(CASES_PREFIX))
        .filter((key) => key.endsWith(".json"))
        .map((key) => key.slice(CASES_PREFIX.length, -".json".length))
        .filter((id) => isSafeCaseId(id));
      const records: CaseRecord[] = [];
      for (let i = 0; i < ids.length; i += LIST_CONCURRENCY) {
        const batch = await Promise.all(
          ids.slice(i, i + LIST_CONCURRENCY).map(async (id) => {
            try {
              return (await read(id))?.record ?? null;
            } catch {
              // One damaged object must not take the inbox down. Log the id only: case
              // content holds (fictitious, but PII-shaped) customer data.
              console.warn(`[store] skipping unreadable case object ${id}.json`);
              return null;
            }
          }),
        );
        for (const record of batch) if (record) records.push(record);
      }
      return records.sort(newestFirst);
    },

    async get(id) {
      if (!isSafeCaseId(id)) return null;
      return (await read(id))?.record ?? null;
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
        const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        for (let attempt = 1; ; attempt++) {
          const current = await read(id);
          if (!current) throw new Error(`Unknown case "${id}"`);
          const merged: CaseRecord = {
            ...current.record,
            ...defined,
            id: current.record.id,
            updatedAt: now().toISOString(),
          };
          try {
            await write(merged, objects.supportsConditionalWrites ? current.etag : undefined);
            return merged;
          } catch (err) {
            if (!(err instanceof PreconditionFailedError) || attempt >= MAX_ATTEMPTS) {
              if (err instanceof PreconditionFailedError) {
                throw new Error(`Case "${id}" is being changed elsewhere: try again`);
              }
              throw err;
            }
          }
        }
      });
    },
  };
}
