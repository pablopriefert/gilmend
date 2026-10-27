import type { CaseRecord, TraceStep } from "../types";

// What update() does to a record, in one place so the file store, the object store and the
// copy-on-write branch of the layered store cannot drift apart.

export type CasePatch = Partial<Omit<CaseRecord, "id">>;

export interface UpdateOptions {
  /**
   * Trace lines to add AFTER the fields of `patch`, appended to the trace the store reads
   * inside its lock. A caller that builds `trace` from an earlier read replaces whatever a
   * concurrent writer added in between; appending here cannot lose a line.
   */
  appendTrace?: TraceStep[];
}

export function mergeCaseUpdate(
  existing: CaseRecord,
  patch: CasePatch,
  options: UpdateOptions | undefined,
  updatedAt: string,
): CaseRecord {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const merged: CaseRecord = { ...existing, ...defined, id: existing.id, updatedAt };
  if (options?.appendTrace?.length) merged.trace = [...merged.trace, ...options.appendTrace];
  return merged;
}
