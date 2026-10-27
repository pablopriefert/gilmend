import type { Engine } from "@/lib/types";

const LABELS: Record<Engine, { text: string; short: string; mock: boolean }> = {
  "muse-spark-1.3": { text: "Muse Spark 1.3 (Meta Model API)", short: "Muse Spark 1.3", mock: false },
  "open-weights": { text: "Open weights (private run)", short: "Open weights", mock: false },
  "demo-mock": { text: "DEMO MODE: deterministic mock, not Muse", short: "DEMO MODE", mock: true },
};

/**
 * Says which engine produced an answer. The mock must never look like Muse, so it gets
 * its own text and a warning style; every screen that shows an agent result uses this.
 * `compact` is for dense lists: a short label, with the full sentence kept for screen
 * readers and the tooltip so the mock is still described as "not Muse".
 */
export function EngineBadge({ engine, compact = false }: { engine: Engine; compact?: boolean }) {
  const { text, short, mock } = LABELS[engine];
  return (
    <span
      data-engine={engine}
      title={compact ? text : undefined}
      aria-label={compact ? text : undefined}
      className={
        mock
          ? "inline-flex items-center whitespace-nowrap rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900"
          : "inline-flex items-center whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900"
      }
    >
      {compact ? short : text}
    </span>
  );
}
