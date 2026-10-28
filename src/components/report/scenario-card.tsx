"use client";

import { useState } from "react";
import { Check, CircleCheck, Hand, LoaderCircle, PackageCheck, PackageX, ScanSearch, Truck, type LucideIcon } from "lucide-react";
import Badge from "../arc/badge/badge";
import type { DemoScenario, OutcomeTone } from "../demo-scenarios";
import { cn } from "@/lib/utils";
import { languageName } from "../format";

// A demo case as a selectable card (Gilmend redesign, 27 Oct 2026): thumbnail, title, carrier and
// the outcome the case is built to show. The card is a button that fills the form; it never sends
// anything. The thumbnail is the same AI-generated demo image the form will attach (illustration
// when the server does not have it), with an empty alt: the title already names it.

const OUTCOME_ICON: Record<OutcomeTone, LucideIcon> = {
  success: PackageCheck,
  neutral: PackageX,
  info: ScanSearch,
  warning: Hand,
};
const BADGE_TONE: Record<OutcomeTone, "success" | "neutral" | "info" | "warning"> = {
  success: "success",
  neutral: "neutral",
  info: "info",
  warning: "warning",
};

function Thumb({ scenario }: { scenario: DemoScenario }) {
  const photo = scenario.photos[0];
  const [src, setSrc] = useState(photo.src);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small same-origin demo image, nothing to optimise
    <img
      src={src}
      alt=""
      width={72}
      height={72}
      loading="lazy"
      decoding="async"
      onError={() => setSrc((current) => (current === photo.fallback ? current : photo.fallback))}
      className="h-[4.5rem] w-[4.5rem] shrink-0 rounded-lg border border-border bg-surface-muted object-cover"
    />
  );
}

export function ScenarioCard({
  scenario,
  selected,
  loading,
  disabled,
  onSelect,
}: {
  scenario: DemoScenario;
  /** The form currently holds this case. */
  selected: boolean;
  /** Its photos are being fetched. */
  loading: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const OutcomeIcon = OUTCOME_ICON[scenario.outcome.tone];
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "group relative flex min-h-11 w-full items-start gap-3.5 rounded-2xl border bg-surface p-3 text-left shadow-card",
        "transition-[border-color,box-shadow,transform] duration-200 ease-out active:translate-y-px motion-reduce:transition-none",
        "enabled:hover:border-border-strong enabled:hover:shadow-raised disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "border-ink ring-1 ring-ink" : "border-border",
      )}
    >
      <Thumb scenario={scenario} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold leading-5 tracking-tight text-foreground">{scenario.title}</span>
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-ink">
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={2} />
            ) : selected ? (
              <CircleCheck className="h-4 w-4" strokeWidth={2} />
            ) : null}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <Truck aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          {scenario.carrier}
          <span aria-hidden="true">·</span>
          <span>{languageName(scenario.language)} message</span>
        </span>
        <span className="text-xs leading-5 text-muted">{scenario.shows}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs text-muted">Expected:</span>
          <Badge tone={BADGE_TONE[scenario.outcome.tone]} icon={<OutcomeIcon className="h-3 w-3" strokeWidth={2} />}>
            {scenario.outcome.label}
          </Badge>
          {selected && !loading && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ink">
              <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.25} />
              In the form
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
