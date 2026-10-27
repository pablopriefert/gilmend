import type { CaseRecord } from "../types";
import { newestFirst } from "./case-order";
import { isSafeCaseId, type CaseStore } from "./file-store";
import { createKeyedLock } from "./keyed-lock";
import { mergeCaseUpdate } from "./merge-update";

// The read-only showcase (src/lib/showcase) layered under a writable store.
//
//  - list():   the writable store's cases, plus every showcase case whose id the writable
//              store does not hold, newest first;
//  - get(id):  the writable store first, then the showcase;
//  - save():   always the writable store (a saved case with a showcase id shadows the
//              recording, which is what `npm run real` does locally);
//  - update(): when the case is only in the showcase, the FIRST change copies it into the
//              writable store with the patch applied (copy-on-write). The committed files are
//              never touched, and from then on the copy is the case. The recording itself
//              stays what Muse produced: `recorded` is kept, and the merchant's action is
//              added to the trace like any other.
//
// Why copy-on-write and not a refusal: the judges can approve, edit or reject a case that
// Muse really produced, which is the whole product. The cost is that, with no shared storage
// (see src/lib/storage), the copy lives in one serverless instance only.

export interface ShowcaseSource {
  list(): Promise<CaseRecord[]>;
  get(id: string): Promise<CaseRecord | null>;
}

export interface LayeredStoreOptions {
  base: CaseStore;
  showcase: ShowcaseSource;
  /** Clock for updatedAt on the copy (tests pin it). */
  now?: () => Date;
}

export function createLayeredCaseStore({ base, showcase, now = () => new Date() }: LayeredStoreOptions): CaseStore {
  // Serialises the "is it already copied?" check with the copy, per case: two quick clicks on
  // a recorded case must not both copy it and lose one of the two changes (the trace lines are
  // kept by `appendTrace`, which the store applies to the record it reads under this lock).
  const withLock = createKeyedLock();

  return {
    async list() {
      const [stored, recorded] = await Promise.all([base.list(), showcase.list()]);
      const held = new Set(stored.map((c) => c.id));
      return [...stored, ...recorded.filter((c) => !held.has(c.id))].sort(newestFirst);
    },

    async get(id) {
      return (await base.get(id)) ?? (await showcase.get(id));
    },

    save(record) {
      return base.save(record);
    },

    async update(id, patch, options) {
      if (!isSafeCaseId(id)) throw new Error(`Unknown case "${id}"`);
      return withLock(id, async () => {
        const stored = await base.get(id);
        if (stored) return base.update(id, patch, options);
        const recorded = await showcase.get(id);
        if (!recorded) throw new Error(`Unknown case "${id}"`);
        return base.save(mergeCaseUpdate(recorded, patch, options, now().toISOString()));
      });
    },
  };
}
