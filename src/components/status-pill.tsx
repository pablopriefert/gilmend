import { CircleCheck, CircleDot, CircleX, Eye, Send, type LucideIcon } from "lucide-react";
import type { CaseStatus } from "@/lib/types";
import { Badge, type BadgeSize, type BadgeTone } from "./arc/badge/badge";
import { STATUS_LABEL } from "./format";

// Icon + text + tone, so a status never rests on colour alone. "Needs review" is the one that
// asks something of the merchant, hence the amber tone and the eye.
const VIEW: Record<CaseStatus, { tone: BadgeTone; icon: LucideIcon }> = {
  new: { tone: "neutral", icon: CircleDot },
  needs_review: { tone: "warning", icon: Eye },
  approved: { tone: "success", icon: CircleCheck },
  rejected: { tone: "neutral", icon: CircleX },
  sent_to_customer: { tone: "info", icon: Send },
};

/**
 * The status of a case, on the Arc Badge. The label is passed as a plain string so that, on a
 * case page, "Needs review" turns into "Approved" with Arc's swap animation instead of snapping.
 */
export function StatusPill({ status, size }: { status: CaseStatus; size?: BadgeSize }) {
  const { tone, icon: Icon } = VIEW[status];
  return (
    <Badge data-status={status} tone={tone} size={size} icon={<Icon className="h-3.5 w-3.5" strokeWidth={2} />}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
