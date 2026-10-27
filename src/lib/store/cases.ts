import { getShowcaseCase, listShowcaseCases } from "../showcase/showcase";
import { sharedObjects } from "../storage";
import type { ObjectStore } from "../storage/object-store";
import type { CaseRecord } from "../types";
import { createCaseStore, defaultCasesDir, type CaseStore } from "./file-store";
import { createLayeredCaseStore } from "./layered-store";
import { createObjectCaseStore } from "./object-case-store";

// Where cases live, chosen by the environment (src/lib/storage/index.ts):
//  - default: local JSON files under <runtime dir>/cases/ (git-ignored): no database to run
//    for the demo (file-store.ts);
//  - with a shared ObjectStore configured: one JSON object per case, visible to every
//    serverless instance (object-case-store.ts).
// Either way the committed read-only showcase (data/showcase/) is layered underneath
// (layered-store.ts). These are the functions the other lots import.

// One store (and so one set of per-case locks) per directory, or per shared object store.
const fileStores = new Map<string, CaseStore>();
const objectStores = new WeakMap<ObjectStore, CaseStore>();

function writableStore(): CaseStore {
  const objects = sharedObjects();
  if (objects) {
    let store = objectStores.get(objects);
    if (!store) {
      store = createObjectCaseStore({ objects });
      objectStores.set(objects, store);
    }
    return store;
  }
  const dir = defaultCasesDir();
  let store = fileStores.get(dir);
  if (!store) {
    store = createCaseStore({ dir });
    fileStores.set(dir, store);
  }
  return store;
}

// The layered store holds the copy-on-write lock, so it is cached with its base.
const layered = new WeakMap<CaseStore, CaseStore>();

function defaultStore(): CaseStore {
  const base = writableStore();
  let store = layered.get(base);
  if (!store) {
    store = createLayeredCaseStore({
      base,
      showcase: { list: () => listShowcaseCases(), get: (id) => getShowcaseCase(id) },
    });
    layered.set(base, store);
  }
  return store;
}

/** All cases, newest first. */
export async function listCases(): Promise<CaseRecord[]> {
  return defaultStore().list();
}

export async function getCase(id: string): Promise<CaseRecord | null> {
  return defaultStore().get(id);
}

/** Insert or replace a case. Returns the stored record. */
export async function saveCase(c: CaseRecord): Promise<CaseRecord> {
  return defaultStore().save(c);
}

/**
 * Merge `patch` into the case and bump `updatedAt`. Throws if the id is unknown. On a recorded
 * showcase case the first call stores a copy; the committed recording is never modified.
 */
export async function updateCase(
  id: string,
  patch: Partial<Omit<CaseRecord, "id">>,
): Promise<CaseRecord> {
  return defaultStore().update(id, patch);
}
