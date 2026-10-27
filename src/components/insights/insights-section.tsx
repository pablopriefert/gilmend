"use client";

import { Clapperboard, FlaskConical } from "lucide-react";
import { useId, useState } from "react";
import type { Insights } from "@/lib/impact/insights";
import { cn } from "@/lib/utils";
import { formatDate } from "../format";
import { CarrierBreakdown } from "./carrier-breakdown";
import { DeadlineTimeline } from "./deadline-timeline";
import { DecisionMix } from "./decision-mix";

/**
 * The Insights band under the hero: money per carrier, the windows that close in the next 14 days,
 * and the decisions. Both versions of the numbers (live only, and live plus recorded runs) are
 * computed on the server and passed in whole, so the toggle only picks one and the browser never
 * receives a trace or a photo path.
 *
 * The toggle starts on "include" only when there is no live case at all: a fresh deployment would
 * otherwise show three empty charts, and the recorded runs are what it has. The state is always
 * said in words ("Counting 6 recorded runs"), and the hero counter above does not move with it.
 */
export function InsightsSection({
  live,
  withRecorded,
  recordedCount,
  recordedAsOf,
}: {
  live: Insights;
  withRecorded: Insights;
  recordedCount: number;
  /** Day of the latest recording (YYYY-MM-DD), null when there is none. */
  recordedAsOf: string | null;
}) {
  const toggleId = useId();
  const [includeRecorded, setIncludeRecorded] = useState(live.cases === 0 && recordedCount > 0);
  const insights = includeRecorded ? withRecorded : live;
  const liveCount = live.cases;
  const asOf = recordedAsOf ? formatDate(`${recordedAsOf}T12:00:00Z`) : null;

  const counting = includeRecorded
    ? `Counting ${liveCount} live ${liveCount === 1 ? "case" : "cases"} and ${recordedCount} recorded ${
        recordedCount === 1 ? "run" : "runs"
      }.`
    : `Counting ${liveCount} live ${liveCount === 1 ? "case" : "cases"}.`;

  return (
    <section aria-labelledby="insights-title" className="flex flex-col gap-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Insights</p>
          <h2 id="insights-title" className="mt-2 font-display text-2xl leading-tight tracking-tight text-ink sm:text-3xl">
            Where the money is, and when it runs out
          </h2>
        </div>
        {recordedCount > 0 && (
          <label
            htmlFor={toggleId}
            className="group flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-ink shadow-card"
          >
            <input
              id={toggleId}
              type="checkbox"
              role="switch"
              checked={includeRecorded}
              onChange={(e) => setIncludeRecorded(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={cn(
                "relative h-6 w-10 shrink-0 rounded-full border transition-colors duration-150 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                includeRecorded ? "border-ink bg-ink" : "border-border-strong bg-surface-muted",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-[18px] w-[18px] rounded-full shadow-card transition-[left,background-color] duration-150",
                  includeRecorded ? "left-[18px] bg-surface" : "left-0.5 bg-ink",
                )}
              />
            </span>
            Include recorded runs
          </label>
        )}
      </header>

      <div className="flex flex-col gap-2 text-sm text-muted">
        <p data-testid="insights-counting" aria-live="polite" className="tabular">
          {counting}
          {!includeRecorded && recordedCount > 0 && asOf && (
            <>
              {" "}
              {recordedCount} real Muse {recordedCount === 1 ? "run" : "runs"} recorded on {asOf} {recordedCount === 1 ? "is" : "are"} left out.
            </>
          )}
        </p>
        {includeRecorded && recordedCount > 0 && (
          <p data-testid="insights-recorded-note" className="flex items-start gap-2">
            <Clapperboard aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>
              Recorded runs are snapshots{asOf ? ` of ${asOf}` : ""}, read as of their recording day: their deadlines count
              from then, not from today. The counters in the band above stay live only.
            </span>
          </p>
        )}
        {insights.demoModeCases > 0 && (
          <p
            data-testid="insights-demo-note"
            className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 font-medium text-warning"
          >
            <FlaskConical aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span>
              Includes {insights.demoModeCases} demo-mode {insights.demoModeCases === 1 ? "case" : "cases"}: scripted
              decisions, not Muse.
            </span>
          </p>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <CarrierBreakdown carriers={insights.carriers} totalEur={insights.recoverableEur} openClaims={insights.openClaims} />
        <DecisionMix decisions={insights.decisions} />
        <DeadlineTimeline timeline={insights.timeline} />
      </div>
    </section>
  );
}
