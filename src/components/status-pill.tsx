import type { CaseStatus } from "@/lib/types";
import { STATUS_LABEL } from "./format";

const STYLES: Record<CaseStatus, string> = {
  new: "bg-slate-100 text-slate-800",
  needs_review: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-stone-200 text-stone-800",
  sent_to_customer: "bg-blue-100 text-blue-900",
};

export function StatusPill({ status }: { status: CaseStatus }) {
  return (
    <span
      data-status={status}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
