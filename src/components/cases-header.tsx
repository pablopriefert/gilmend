import Link from "next/link";
import type { CaseRecord } from "@/lib/types";
import { summarizeCases, summarizeRecordedRuns } from "@/lib/store/summary";
import { formatDate, formatEur } from "./format";

/** Page title plus the counter: "€1,240 recoverable this month · 3 claims due this week". */
export function CasesHeader({ cases, now }: { cases: CaseRecord[]; now: Date }) {
  const { recoverableThisMonthEur: recoverableEur, claimsDueThisWeek, demoModeCases } = summarizeCases(cases, now);
  const recorded = summarizeRecordedRuns(cases);
  const recordedCases = recorded.count;
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cases</h1>
        <p className="mt-2 text-lg" data-testid="counter">
          <strong className="font-semibold">{formatEur(recoverableEur, { whole: true })}</strong> recoverable
          this month{" "}
          <span aria-hidden="true" className="px-1 text-muted">
            ·
          </span>{" "}
          <strong className="font-semibold">{claimsDueThisWeek}</strong>{" "}
          {claimsDueThisWeek === 1 ? "claim" : "claims"} due this week
        </p>
        {recordedCases > 0 && recorded.asOf && (
          // A second figure, not part of the one above: on a fresh deployment the live counter
          // reads 0 because the recorded runs are not counted, and this is what they found.
          <p className="mt-1 text-base" data-testid="recorded-counter">
            Recorded runs:{" "}
            <strong className="font-semibold">{formatEur(recorded.recoverableEur, { whole: false })}</strong>{" "}
            recoverable (as of {formatDate(`${recorded.asOf}T12:00:00Z`)})
          </p>
        )}
        <p className="mt-1 text-sm text-muted">
          Maximum compensation under each carrier&apos;s rules, for claims the agent found eligible and you
          have not rejected. Not a promise of payment.
        </p>
        {recordedCases > 0 && (
          <p className="mt-1 text-sm text-muted" data-testid="recorded-note">
            {recordedCases} recorded {recordedCases === 1 ? "run" : "runs"} (real Muse runs saved with the code)
            {recordedCases === 1 ? " is" : " are"} listed below but not counted in the live counter.
          </p>
        )}
        {demoModeCases > 0 && (
          <p className="mt-1 text-sm text-muted" data-testid="demo-mode-note">
            Includes {demoModeCases} demo-mode {demoModeCases === 1 ? "case" : "cases"}: scripted decisions,
            not Muse.
          </p>
        )}
      </div>
      <Link
        href="/report"
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
      >
        Report a damaged parcel
      </Link>
    </div>
  );
}
