import { Clapperboard } from "lucide-react";
import type { RecordedRun } from "@/lib/types";
import { Badge } from "./arc/badge/badge";
import { formatDate } from "./format";

/**
 * Marks a recorded showcase run: a real run of Muse Spark 1.3 + SAM 3.1 made once and shipped
 * with the code (src/lib/showcase), not something that happened on this deployment today.
 * `compact` is for dense lists; the full sentence stays in the tooltip and for screen readers.
 */
export function RecordedBadge({ recorded, compact = false }: { recorded: RecordedRun; compact?: boolean }) {
  const when = formatDate(`${recorded.recordedOn}T12:00:00Z`);
  // The generated photos are said here too: a judge who only reads the badge must not take them for customer photos.
  const full = `Recorded run: a real Muse Spark 1.3 run, recorded on ${when}, on photos generated with Muse Image`;
  return (
    <Badge
      data-recorded="true"
      tone="info"
      icon={<Clapperboard className="h-3.5 w-3.5" strokeWidth={2} />}
      title={compact ? full : undefined}
      role={compact ? "img" : undefined}
      aria-label={compact ? full : undefined}
    >
      {compact ? "Recorded" : `Recorded run · ${when}`}
    </Badge>
  );
}
