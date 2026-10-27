import Link from "next/link";
import type { CaseRecord } from "@/lib/types";
import { EngineBadge } from "./engine-badge";
import { CARRIER_LABEL, deadlineInfo, formatDate, formatEur } from "./format";
import { StatusPill } from "./status-pill";

const TONE_CLASS = {
  none: "text-muted",
  ok: "text-foreground",
  soon: "font-semibold text-amber-800",
  overdue: "font-semibold text-danger",
} as const;

function itemTitle(c: CaseRecord): string {
  return c.assessment?.item || c.order?.lineItems[0]?.title || "Unidentified item";
}

function CaseRow({ c, now }: { c: CaseRecord; now: Date }) {
  const claimable = Boolean(c.decision?.carrierClaim && c.claim?.eligible);
  const deadline = deadlineInfo(claimable ? c.claim : null, now);
  const carrier = c.order ? CARRIER_LABEL[c.order.carrier] : "Unknown carrier";
  return (
    <li>
      <Link
        href={`/cases/${c.id}`}
        className="grid gap-x-4 gap-y-2 px-4 py-4 hover:bg-accent-soft/50 sm:grid-cols-[minmax(0,2fr)_9rem_minmax(0,1.2fr)_8rem_9rem_8.5rem] sm:items-center"
      >
        <div className="min-w-0">
          <div className="truncate font-medium">
            {c.order?.id ?? c.report.orderNumber}
            <span className="font-normal text-muted"> · {c.order?.name ?? c.report.customerEmail}</span>
          </div>
          <div className="truncate text-sm text-muted">{itemTitle(c)}</div>
        </div>
        <div>
          <StatusPill status={c.status} />
        </div>
        <div className="truncate text-sm">{carrier}</div>
        <div className="text-sm">
          {claimable && c.claim ? (
            <>
              <span className="sm:hidden text-muted">Up to </span>
              <span className="font-medium">{formatEur(c.claim.maxCompensationEur)}</span>
            </>
          ) : (
            <span className="text-muted">No claim</span>
          )}
        </div>
        <div className={`text-sm ${TONE_CLASS[deadline.tone]}`}>
          {deadline.text}
          {claimable && c.claim?.claimDeadline && deadline.tone !== "none" && (
            <span className="block text-xs font-normal text-muted">by {formatDate(c.claim.claimDeadline)}</span>
          )}
        </div>
        <div>
          <EngineBadge engine={c.engine} detail={c.engineDetail} compact />
        </div>
      </Link>
    </li>
  );
}

/** The list of cases: one row per case, responsive (stacked on a phone, columns from `sm`). */
export function CaseList({ cases, now }: { cases: CaseRecord[]; now: Date }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[minmax(0,2fr)_9rem_minmax(0,1.2fr)_8rem_9rem_8.5rem] gap-x-4 border-b border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted sm:grid"
      >
        <div>Order</div>
        <div>Status</div>
        <div>Carrier</div>
        <div>Max. amount</div>
        <div>Claim deadline</div>
        <div>Engine</div>
      </div>
      <ul className="divide-y divide-border" aria-label="Cases">
        {cases.map((c) => (
          <CaseRow key={c.id} c={c} now={now} />
        ))}
      </ul>
    </div>
  );
}
