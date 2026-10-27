import { caseRound } from "@/lib/rounds";
import type { CaseRecord } from "@/lib/types";
import { CaseTable, type CaseRowData } from "./dashboard/case-table";
import { CARRIER_LABEL, caseClock, deadlineInfo, formatDate, formatEur } from "./format";

function itemTitle(c: CaseRecord): string {
  const title = c.assessment?.item || c.order?.lineItems[0]?.title || "Unidentified item";
  // Muse writes the item in lower case ("glass carafe"); a list title starts with a capital.
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** Turns a stored case into the few formatted strings a row shows (server side, so the browser gets no trace or photo paths). */
function toRow(c: CaseRecord, now: Date): CaseRowData {
  const claimable = Boolean(c.decision?.carrierClaim && c.claim?.eligible);
  const deadline = deadlineInfo(claimable ? c.claim : null, caseClock(c, now));
  return {
    id: c.id,
    orderId: c.order?.id ?? c.report.orderNumber,
    customer: c.order?.name ?? c.report.customerEmail,
    item: itemTitle(c),
    carrier: c.order ? CARRIER_LABEL[c.order.carrier] : "Unknown carrier",
    status: c.status,
    engine: c.engine,
    engineDetail: c.engineDetail,
    recorded: c.recorded,
    round: caseRound(c),
    amount: claimable && c.claim ? formatEur(c.claim.maxCompensationEur) : null,
    deadline,
    by: claimable && c.claim?.claimDeadline && deadline.tone !== "none" ? formatDate(c.claim.claimDeadline) : null,
  };
}

/** The list of cases: a table from tablet width, stacked cards on a phone (see CaseTable). */
export function CaseList({ cases, now }: { cases: CaseRecord[]; now: Date }) {
  return <CaseTable rows={cases.map((c) => toRow(c, now))} />;
}
