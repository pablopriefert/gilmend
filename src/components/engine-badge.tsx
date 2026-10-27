import { FlaskConical, Network, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import type { Engine, EngineDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge, type BadgeSize, type BadgeTone } from "./arc/badge/badge";

const LABELS: Record<Engine, { text: string; short: string; mock: boolean; tone: BadgeTone; icon: LucideIcon }> = {
  "muse-spark-1.3": { text: "Muse Spark 1.3 (Meta Model API)", short: "Muse Spark 1.3", mock: false, tone: "success", icon: Sparkles },
  "open-weights": { text: "Open weights (private run)", short: "Open weights", mock: false, tone: "success", icon: ShieldCheck },
  openrouter: { text: "Muse via OpenRouter (test engine, not private)", short: "OpenRouter (test)", mock: false, tone: "neutral", icon: Network },
  "demo-mock": { text: "DEMO MODE: deterministic mock, not Muse", short: "DEMO MODE", mock: true, tone: "warning", icon: FlaskConical },
};

/**
 * Says which engine produced an answer. The mock must never look like Muse, so it gets
 * its own text, an amber warning tone and a flask icon; every screen that shows an agent result uses this.
 * `compact` is for dense lists: a short label, with the full sentence kept for screen
 * readers and the tooltip so the mock is still described as "not Muse".
 * `detail` names the model and host that really ran an open-weights or OpenRouter case
 * ("Muse Spark Open on Baseten"); without it the badge can only say "Open weights".
 * Built on the Arc Badge (icon + text, never colour alone). The label sits in its own span
 * carrying `data-engine`, so the badge keeps its text and its test hooks.
 */
export function EngineBadge({
  engine,
  compact = false,
  detail,
  size,
  className,
}: {
  engine: Engine;
  compact?: boolean;
  detail?: EngineDetail;
  size?: BadgeSize;
  className?: string;
}) {
  const base = LABELS[engine];
  const named = detail && (engine === "open-weights" || engine === "openrouter");
  const text = named ? detail.label : base.text;
  const short = named ? detail.short : base.short;
  const Icon = base.icon;
  return (
    <Badge
      tone={base.tone}
      size={size}
      icon={<Icon className="h-3.5 w-3.5" strokeWidth={2} />}
      title={compact ? text : undefined}
      role={compact ? "img" : undefined}
      aria-label={compact ? text : undefined}
      className={cn(
        "max-w-full",
        // Arc's badge never wraps (nowrap, clipped, max-content); a full engine sentence must, or it is cut without an ellipsis.
        !compact &&
          "h-auto! py-1! leading-snug! whitespace-normal! [&_span]:whitespace-normal! [&_span]:w-auto! [&_span]:max-w-full!",
        base.mock && "font-semibold! ring-1 ring-warning/20",
        className,
      )}
    >
      <span data-engine={engine}>{compact ? short : text}</span>
    </Badge>
  );
}
