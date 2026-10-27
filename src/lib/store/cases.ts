import type { CaseRecord } from "../types";
import { createCaseStore, defaultCasesDir, type CaseStore } from "./file-store";

// Local JSON files under data/runtime/cases/ (git-ignored): no database to run for the
// demo. The logic lives in file-store.ts; these are the functions the other lots import.

// One store (and so one set of per-case locks) per directory.
const stores = new Map<string, CaseStore>();

function defaultStore(): CaseStore {
  const dir = defaultCasesDir();
  let store = stores.get(dir);
  if (!store) {
    store = createCaseStore({ dir });
    stores.set(dir, store);
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

/** Merge `patch` into the case and bump `updatedAt`. Throws if the id is unknown. */
export async function updateCase(
  id: string,
  patch: Partial<Omit<CaseRecord, "id">>,
): Promise<CaseRecord> {
  return defaultStore().update(id, patch);
}
