import { TriangleAlert } from "lucide-react";
import type { CaseRecord } from "@/lib/types";
import { CaseList } from "./case-list";
import { CasesHeader } from "./cases-header";
import { EmptyState } from "./dashboard/empty-state";
import { HowItWorks } from "./dashboard/how-it-works";

/**
 * The Cases screen: the hero band, a one-line "how it works", then the list. `error` is set when
 * the case store could not be read: the page says so instead of showing an empty list that would
 * look like "no damage reported".
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
    <div className="flex flex-col gap-10">
      <CasesHeader cases={cases} now={now} />
      <HowItWorks />
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger-soft px-5 py-4 text-danger"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
          <p className="text-sm font-medium leading-relaxed">{error}</p>
        </div>
      ) : cases.length === 0 ? (
        <EmptyState />
      ) : (
        <CaseList cases={cases} now={now} />
      )}
    </div>
  );
}
