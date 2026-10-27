import { CalendarClock, Clock3, Minus, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeadlineTone } from "../format";

// Urgency is icon + words + tone: "Overdue" and "Due today" never rest on colour alone.
const TONES: Record<DeadlineTone, { icon: LucideIcon; className: string }> = {
  none: { icon: Minus, className: "text-muted" },
  ok: { icon: CalendarClock, className: "text-ink-soft" },
  soon: { icon: Clock3, className: "rounded-full bg-warning-soft px-2.5 py-1 font-semibold text-warning ring-1 ring-warning/25" },
  overdue: { icon: TriangleAlert, className: "rounded-full bg-danger-soft px-2.5 py-1 font-semibold text-danger ring-1 ring-danger/25" },
};

/** Claim deadline of a case: icon + "6 days left" (+ the date under it when there is a claim). */
export function Deadline({ text, tone, by }: { text: string; tone: DeadlineTone; by: string | null }) {
  const { icon: Icon, className } = TONES[tone];
  return (
    <div>
      <span className={cn("tabular inline-flex items-center gap-1.5 text-sm", className)}>
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
        {text}
      </span>
      {by && <span className="tabular mt-1 block text-xs text-muted">by {by}</span>}
    </div>
  );
}
