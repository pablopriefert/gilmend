"use client";

import { ChevronRight, Repeat2, Truck } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { CaseStatus, Engine, EngineDetail, RecordedRun } from "@/lib/types";
import { cn } from "@/lib/utils";
import SegmentedControl from "../arc/segmented-control/segmented-control";
import { Badge } from "../arc/badge/badge";
import { EngineBadge } from "../engine-badge";
import type { DeadlineTone } from "../format";
import { RecordedBadge } from "../recorded-badge";
import { StatusPill } from "../status-pill";
import { Deadline } from "./deadline";

/** What one row needs, already formatted on the server (so the browser receives a few KB, not whole cases). */
export interface CaseRowData {
  id: string;
  orderId: string;
  customer: string;
  item: string;
  carrier: string;
  status: CaseStatus;
  engine: Engine;
  engineDetail?: EngineDetail;
  recorded?: RecordedRun;
  /** Round of the case: 2 or more once the customer replied (the case was followed up). */
  round?: number;
  /** Formatted "up to" amount, or null when the case has no carrier claim. */
  amount: string | null;
  deadline: { text: string; tone: DeadlineTone };
  /** Formatted claim deadline, shown under the urgency text. */
  by: string | null;
}

// One grid for the header and every row, from laptop width up (six columns need about 1024px). Below it, a row is a stacked card.
const COLUMNS = "lg:grid-cols-[minmax(0,2.4fr)_9.5rem_minmax(0,1.1fr)_minmax(0,1.3fr)_8.5rem_1rem]";

const FILTERS: { value: string; label: string; match: (s: CaseStatus) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "needs_review", label: "Needs review", match: (s) => s === "needs_review" },
  { value: "approved", label: "Approved", match: (s) => s === "approved" },
  { value: "closed", label: "Closed", match: (s) => s === "rejected" || s === "sent_to_customer" },
];

function CaseRow({ row, index }: { row: CaseRowData; index: number }) {
  const base = useId();
  const itemId = `${base}-item`;
  const refId = `${base}-ref`;
  // The link is named by the item and the customer; everything else a row says (status, honesty
  // badges, deadline, amount) is its description, so a screen reader hears the whole row.
  const statusId = `${base}-status`;
  const badgesId = `${base}-badges`;
  const deadlineId = `${base}-deadline`;
  const amountId = `${base}-amount`;
  return (
    <li
      className={cn(
        "animate-rise rounded-2xl border border-border bg-surface shadow-card",
        "lg:rounded-none lg:border-0 lg:border-t lg:shadow-none lg:first:border-t-0",
      )}
      style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
    >
      <Link
        href={`/cases/${row.id}`}
        aria-labelledby={`${itemId} ${refId}`}
        aria-describedby={`${statusId} ${badgesId} ${deadlineId} ${amountId}`}
        className={cn(
          "group grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 rounded-[inherit] p-4 outline-offset-[-3px]",
          "transition-colors duration-150 hover:bg-accent-soft/60 active:bg-accent-soft",
          "lg:items-center lg:gap-x-6 lg:px-6 lg:py-5",
          COLUMNS,
        )}
      >
        <div className="col-start-1 row-start-1 min-w-0 lg:col-start-1">
          <p id={itemId} className="truncate text-[15px] font-medium text-ink">
            {row.item}
          </p>
          <p id={refId} className="mt-0.5 truncate text-sm text-muted">
            <span className="font-mono text-[13px] text-ink-soft">{row.orderId}</span> · {row.customer}
          </p>
          <div id={badgesId} className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <EngineBadge engine={row.engine} detail={row.engineDetail} compact />
            {row.recorded && <RecordedBadge recorded={row.recorded} compact />}
            {row.round !== undefined && row.round > 1 && (
              <Badge tone="info" size="sm" icon={<Repeat2 className="h-3.5 w-3.5" strokeWidth={2} />}>
                {`Round ${row.round}`}
              </Badge>
            )}
          </div>
        </div>
        <div id={statusId} className="col-start-2 row-start-1 justify-self-end lg:col-start-2 lg:justify-self-start">
          <StatusPill status={row.status} />
        </div>
        <div className="col-start-1 row-start-2 lg:col-start-3 lg:row-start-1">
          <span className="inline-flex items-center gap-2 text-sm text-ink-soft">
            <Truck aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} />
            <span>{row.carrier}</span>
          </span>
        </div>
        <div id={deadlineId} className="col-start-1 row-start-3 lg:col-start-4 lg:row-start-1">
          <Deadline text={row.deadline.text} tone={row.deadline.tone} by={row.by} />
        </div>
        <div id={amountId} className="col-start-2 row-span-2 row-start-2 self-end text-right lg:col-start-5 lg:row-span-1 lg:row-start-1 lg:self-center">
          {row.amount ? (
            <>
              <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-muted">Up to</span>
              <span className="tabular block font-display text-[1.7rem] leading-none text-gold-ink">{row.amount}</span>
            </>
          ) : (
            <span className="text-sm text-muted">No claim</span>
          )}
        </div>
        <ChevronRight
          aria-hidden="true"
          className="col-start-6 row-start-1 hidden h-4 w-4 text-border-strong transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink lg:block"
        />
      </Link>
    </li>
  );
}

/**
 * The cases, as a table on laptop and desktop and as stacked cards on a phone or tablet, with a status
 * filter (Arc segmented control). Filtering is client-side over the rows already on the page.
 */
export function CaseTable({ rows }: { rows: CaseRowData[] }) {
  const [filter, setFilter] = useState("all");
  const active = FILTERS.find((f) => f.value === filter) ?? FILTERS[0];
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.value, rows.filter((r) => f.match(r.status)).length])),
    [rows],
  );
  const shown = rows.filter((r) => active.match(r.status));

  return (
    <section aria-labelledby="reports-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-baseline gap-3">
          <h2 id="reports-title" className="font-display text-2xl text-ink sm:text-[1.75rem]">
            Damage reports
          </h2>
          <span className="tabular text-sm text-muted">
            {shown.length === rows.length ? `${rows.length}` : `${shown.length} of ${rows.length}`}
          </span>
        </div>
        {rows.length > 1 && (
          <SegmentedControl
            label="Filter cases by status"
            value={filter}
            onValueChange={setFilter}
            // Arc reads its control height from a variable (its CSS module is unlayered, so a utility class could not override it). A mouse gets the compact control, a finger keeps 44 px.
            className="[--control-height-sm:2.75rem] pointer-fine:[--control-height-sm:2rem]"
            options={FILTERS.map((f) => ({
              value: f.value,
              label: f.label,
              accessory: <span className="tabular text-xs text-muted">{counts[f.value]}</span>,
            }))}
          />
        )}
      </div>
      <p role="status" className="sr-only">
        Showing {shown.length} of {rows.length} {rows.length === 1 ? "case" : "cases"}
      </p>
      <div className="lg:overflow-hidden lg:rounded-2xl lg:border lg:border-border lg:bg-surface lg:shadow-card">
        <div
          aria-hidden="true"
          className={cn(
            "hidden gap-x-6 border-b border-border bg-surface-muted px-6 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted lg:grid",
            COLUMNS,
          )}
        >
          <span>Case</span>
          <span>Status</span>
          <span>Carrier</span>
          <span>Claim deadline</span>
          <span className="text-right">Max. amount</span>
          <span />
        </div>
        {shown.length > 0 ? (
          <ul aria-label="Cases" className="flex flex-col gap-3 lg:gap-0">
            {shown.map((row, i) => (
              <CaseRow key={row.id} row={row} index={i} />
            ))}
          </ul>
        ) : (
          <div className="rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-12 text-center lg:rounded-none lg:border-0">
            <p className="text-sm text-muted">No case matches this filter.</p>
            <button
              type="button"
              onClick={() => setFilter("all")}
              className="mt-3 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-accent underline-offset-4 hover:underline"
            >
              Show all cases
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
