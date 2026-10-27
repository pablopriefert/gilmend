import type { Engine, EngineDetail } from "@/lib/types";

const LABELS: Record<Engine, { text: string; short: string; mock: boolean }> = {
  "muse-spark-1.3": { text: "Muse Spark 1.3 (Meta Model API)", short: "Muse Spark 1.3", mock: false },
  "open-weights": { text: "Open weights (private run)", short: "Open weights", mock: false },
  openrouter: { text: "Muse via OpenRouter (test engine, not private)", short: "OpenRouter (test)", mock: false },
  "demo-mock": { text: "DEMO MODE: deterministic mock, not Muse", short: "DEMO MODE", mock: true },
};

/**
 * Says which engine produced an answer. The mock must never look like Muse, so it gets
 * its own text and a warning style; every screen that shows an agent result uses this.
 * `compact` is for dense lists: a short label, with the full sentence kept for screen
 * readers and the tooltip so the mock is still described as "not Muse".
 * `detail` names the model and host that really ran an open-weights or OpenRouter case
 * ("Muse Spark Open on Baseten"); without it the badge can only say "Open weights".
 */
export function EngineBadge({
  engine,
  compact = false,
  detail,
}: {
  engine: Engine;
  compact?: boolean;
  detail?: EngineDetail;
}) {
  const base = LABELS[engine];
  const named = detail && (engine === "open-weights" || engine === "openrouter");
  const text = named ? detail.label : base.text;
  const short = named ? detail.short : base.short;
  const mock = base.mock;
  return (
    <span
      data-engine={engine}
      title={compact ? text : undefined}
      aria-label={compact ? text : undefined}
      className={
        mock
          ? "inline-flex items-center whitespace-nowrap rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900"
          : engine === "openrouter"
            ? "inline-flex items-center whitespace-nowrap rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-900"
            : "inline-flex items-center whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900"
      }
    >
      {compact ? short : text}
    </span>
  );
}
