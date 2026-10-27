import type { CaseRecord } from "../types";

/** Newest first (createdAt), ties broken by id so the order is stable. */
export function newestFirst(a: CaseRecord, b: CaseRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}
