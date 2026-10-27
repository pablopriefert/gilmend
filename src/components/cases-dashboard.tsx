import Link from "next/link";
import type { CaseRecord } from "@/lib/types";
import { CaseList } from "./case-list";
import { CasesHeader } from "./cases-header";

/**
 * The Cases screen. `error` is set when the case store could not be read: the page says so
 * instead of showing an empty list that would look like "no damage reported".
 */
export function CasesDashboard({
  cases,
  error,
  now,
}: {
  cases: CaseRecord[];
  error: string | null;
  now: Date;
}) {
  return (
    <div className="flex flex-col gap-6">
      <CasesHeader cases={cases} now={now} />
      {error ? (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm text-danger">
          {error}
        </div>
      ) : cases.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
          <h2 className="text-lg font-semibold">No cases yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            A case appears here when a customer reports a damaged parcel. Simulate one, or load a demo case
            in a single click.
          </p>
          <Link
            href="/report"
            className="mt-5 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Report a damaged parcel
          </Link>
        </div>
      ) : (
        <CaseList cases={cases} now={now} />
      )}
    </div>
  );
}
