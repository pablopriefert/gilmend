import Link from "next/link";
import { Clapperboard, Clock3 } from "lucide-react";
import {
  CARRIER_ORDER,
  formatCountdown,
  URGENT_DAYS,
  windowLabelShort,
  type Insights,
  type TimelineEvent,
} from "@/lib/impact/insights";
import { cn } from "@/lib/utils";
import { CARRIER_LABEL, formatDate, formatDateTime, formatEur } from "../format";
import { Panel } from "./panel";

// The chart is a strip per carrier over the next 14 days. It is drawn for the eye and hidden from
// assistive technology (aria-hidden): the ordered list under it carries every event as text, so
// nothing is only in the picture. Colour never carries a meaning alone: the shape says the kind
// (circle = claim deadline, diamond = reserve window), a hollow ring says "recorded run", and the
// short windows sit in a shaded zone that is also named in the axis and in the list.

const TICKS = [0, 3, 7, 14];

function position(days: number, horizonDays: number): string {
  // A 10 px inner margin keeps a marker on day 0 or 14 from being cut by the rounded track.
  const f = Math.min(1, Math.max(0, days / horizonDays));
  return `calc(10px + (100% - 20px) * ${f})`;
}

/**
 * Urgency is a statement about the clock on the wall. A recorded run sits on the axis counted from
 * its own recording day (27 Oct 2026 review: "Mondial Relay, under 2 days" read as a live alarm
 * when it was a snapshot), so it never wears the warning colour: its hollow ring and the words
 * "after the recording" say what it is.
 */
function isUrgent(event: TimelineEvent): boolean {
  return event.urgent && event.recordedOn === null;
}

function Glyph({ event, className }: { event: TimelineEvent; className?: string }) {
  const recorded = event.recordedOn !== null;
  const tone = isUrgent(event) ? "warning" : "ink";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-3.5 w-3.5 shrink-0",
        event.kind === "reserve" ? "rotate-45 rounded-[3px]" : "rounded-full",
        recorded
          ? cn("border-2 bg-surface", tone === "warning" ? "border-warning" : "border-ink")
          : tone === "warning"
            ? "bg-warning"
            : "bg-ink",
        className,
      )}
    />
  );
}

function when(event: TimelineEvent): string {
  const countdown = formatCountdown(event.hoursFromRead);
  return event.recordedOn !== null ? `${countdown.replace(/^in /, "")} after the recording` : countdown;
}

function kindText(event: TimelineEvent): string {
  if (event.kind === "claim") return "Last day to file the claim";
  return event.binding
    ? "Reserve window ends: a later report is rejected"
    : `Reserve window ends (${event.basis}: a later report only adds a warning)`;
}

function LegendItem({ children, swatch }: { children: string; swatch: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      {swatch}
      <span>{children}</span>
    </li>
  );
}

/** The label of day 0: "Now" for live cases, "Recording" when every event is a recorded run. */
export function axisOriginLabel(events: TimelineEvent[]): string {
  return events.length > 0 && events.every((e) => e.recordedOn !== null) ? "Recording" : "Now";
}

export function DeadlineTimeline({ timeline }: { timeline: Insights["timeline"] }) {
  const { horizonDays, events, later } = timeline;
  const hasLiveEvent = events.some((e) => e.recordedOn === null);
  const hasLiveUrgent = events.some(isUrgent);
  return (
    <Panel
      id="insights-timeline"
      title={`Deadlines in the next ${horizonDays} days`}
      description="The short windows are the claims that quietly expire: a deadline missed here is money lost for good."
      className="lg:col-span-2"
    >
      {events.length === 0 ? (
        <p data-testid="timeline-empty" className="text-sm text-muted">
          No claim or reserve window closes in the next {horizonDays} days.
        </p>
      ) : (
        <>
          <div aria-hidden="true" data-testid="timeline-chart" className="flex flex-col gap-3">
            {CARRIER_ORDER.map((carrier) => {
              const own = events.filter((e) => e.carrier === carrier);
              return (
                <div key={carrier} className="grid gap-1.5 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:items-center sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{CARRIER_LABEL[carrier]}</p>
                    <p className="hidden text-xs text-muted sm:block">{windowLabelShort(carrier)}</p>
                  </div>
                  <div className="relative h-9 rounded-lg bg-surface-muted ring-1 ring-border">
                    {hasLiveEvent && (
                      <div
                        className="absolute inset-y-0 left-0 rounded-l-lg bg-warning-soft"
                        style={{ width: `calc(10px + (100% - 20px) * ${URGENT_DAYS / horizonDays})` }}
                      />
                    )}
                    {TICKS.filter((t) => t > 0 && t < horizonDays).map((t) => (
                      <span
                        key={t}
                        className="absolute inset-y-1.5 w-px bg-border-strong/70"
                        style={{ left: position(t, horizonDays) }}
                      />
                    ))}
                    {own.map((e) => (
                      <span
                        key={`${e.caseId}-${e.kind}`}
                        className="absolute top-1/2"
                        style={{ left: position(e.hoursFromRead / 24, horizonDays), transform: "translate(-50%, -50%)" }}
                      >
                        <Glyph event={e} className="ring-2 ring-surface" />
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="grid sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-4">
              <span className="hidden sm:block" />
              <div className="relative h-5 text-xs text-muted">
                {TICKS.filter((t) => t <= horizonDays).map((t) => (
                  <span
                    key={t}
                    className={cn("tabular absolute top-0 whitespace-nowrap", t === horizonDays ? "-translate-x-full" : "-translate-x-1/2")}
                    style={{ left: position(t, horizonDays) }}
                  >
                    {t === 0 ? axisOriginLabel(events) : `${t} d`}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted" aria-label="Legend">
            <LegendItem swatch={<span aria-hidden="true" className="h-3 w-3 rounded-full bg-ink" />}>
              Claim deadline
            </LegendItem>
            <LegendItem swatch={<span aria-hidden="true" className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-ink" />}>
              Reserve window
            </LegendItem>
            <LegendItem swatch={<span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-ink bg-surface" />}>
              Recorded run (counted from its recording day)
            </LegendItem>
            {hasLiveUrgent && (
              <LegendItem swatch={<span aria-hidden="true" className="h-3 w-3 rounded-full bg-warning" />}>
                {`Under ${URGENT_DAYS} days from now`}
              </LegendItem>
            )}
          </ul>

          <ol aria-label={`Windows closing in the next ${horizonDays} days, soonest first`} className="flex flex-col divide-y divide-border">
            {events.map((e) => (
              <li
                key={`${e.caseId}-${e.kind}`}
                data-testid={`deadline-${e.caseId}-${e.kind}`}
                className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <Glyph event={e} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    <Link href={`/cases/${e.caseId}`} className="rounded underline decoration-border-strong underline-offset-2 hover:decoration-ink">
                      {e.orderId}
                    </Link>
                    <span className="font-normal text-muted">{` · ${CARRIER_LABEL[e.carrier]}`}</span>
                  </p>
                  <p className="text-sm text-ink-soft">{kindText(e)}</p>
                  <p className="tabular mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <span className={cn(isUrgent(e) && "inline-flex items-center gap-1 font-semibold text-warning")}>
                      {isUrgent(e) && <Clock3 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />}
                      {when(e)}
                      {isUrgent(e) && `, under ${URGENT_DAYS} days`}
                    </span>
                    <span>{formatDateTime(e.at)}</span>
                    {e.recordedOn !== null && (
                      <span className="inline-flex items-center gap-1">
                        <Clapperboard aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                        Recorded run of {formatDate(`${e.recordedOn}T12:00:00Z`)}
                      </span>
                    )}
                  </p>
                </div>
                {e.amountEur !== null && (
                  <p className="tabular shrink-0 text-sm font-semibold text-gold-ink">{formatEur(e.amountEur)}</p>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      {later.count > 0 && later.firstAt !== null && (
        <p data-testid="timeline-later" className="tabular border-t border-border pt-4 text-sm text-muted">
          {later.count} more {later.count === 1 ? "claim closes" : "claims close"} after {horizonDays} days, the first on{" "}
          {formatDate(later.firstAt)}, worth {formatEur(later.eur)} in all.
        </p>
      )}
    </Panel>
  );
}
