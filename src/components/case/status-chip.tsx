import { CircleCheck, CircleDashed, CircleX, Eye, Send, type LucideIcon } from "lucide-react";
import type { CaseStatus } from "@/lib/types";
import { STATUS_LABEL } from "../format";
import { Pill, type Tone } from "./ui";

const STATUS: Record<CaseStatus, { icon: LucideIcon; tone: Tone }> = {
  new: { icon: CircleDashed, tone: "neutral" },
  needs_review: { icon: Eye, tone: "warn" },
  approved: { icon: CircleCheck, tone: "ok" },
  rejected: { icon: CircleX, tone: "neutral" },
  sent_to_customer: { icon: Send, tone: "info" },
};

/** The case status with an icon and a word (never colour alone). Carries data-status like StatusPill. */
export function StatusChip({ status }: { status: CaseStatus }) {
  const { icon, tone } = STATUS[status];
  return (
    <Pill tone={tone} icon={icon} data-status={status} className="px-3 py-1.5">
      {STATUS_LABEL[status]}
    </Pill>
  );
}
