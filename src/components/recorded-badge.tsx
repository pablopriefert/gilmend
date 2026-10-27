import type { RecordedRun } from "@/lib/types";
import { formatDate } from "./format";

/**
 * Marks a recorded showcase run: a real run of Muse Spark 1.3 + SAM 3.1 made once and shipped
 * with the code (src/lib/showcase), not something that happened on this deployment today.
 * `compact` is for dense lists; the full sentence stays in the tooltip and for screen readers.
 */
export function RecordedBadge({ recorded, compact = false }: { recorded: RecordedRun; compact?: boolean }) {
  const when = formatDate(`${recorded.recordedOn}T12:00:00Z`);
  // The stand-in photos are said here too: a judge who only reads the badge must not take them for customer photos.
  const full = `Recorded run: a real Muse Spark 1.3 run, recorded on ${when}, on provisional AI-generated stand-in photos`;
  return (
    <span
      data-recorded="true"
      title={compact ? full : undefined}
      aria-label={compact ? full : undefined}
      className="inline-flex items-center whitespace-nowrap rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-900"
    >
      {compact ? "Recorded" : `Recorded run · ${when}`}
    </span>
  );
}
