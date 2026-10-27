"use client";

import { Check, FlaskConical, Network, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import type { Engine } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EngineBadge } from "./engine-badge";
import { detailFor, effectiveEngine, engineOptions, type EngineAvailability } from "./engine-choice";

// The same icons as EngineBadge, so an engine looks the same in the chooser and on a case.
const ENGINE_ICON: Record<Engine, LucideIcon> = {
  "muse-spark-1.3": Sparkles,
  "open-weights": ShieldCheck,
  openrouter: Network,
  "demo-mock": FlaskConical,
};

/**
 * One honest line on where the photos and the message go for what the report will REALLY run
 * as (not what was clicked: a server without the key runs the mock). Said plainly: "private"
 * is not "on your hardware".
 */
export function photoDestination(engine: Engine, availability: EngineAvailability): string {
  switch (engine) {
    case "demo-mock":
      return "No model is called and no photo is sent to any model.";
    case "muse-spark-1.3":
      return "The photos and the message go to the Meta Model API.";
    case "openrouter":
      return "The photos and the message go to OpenRouter and Meta. Not private.";
    case "open-weights": {
      const host = detailFor("open-weights", availability)?.host;
      if (host === "baseten") return "The photos and the message go to Baseten (not your own hardware), never to the Meta Model API.";
      if (host === "modal") return "The photos and the message go to the Modal deployment of this server, never to the Meta Model API.";
      return "The photos and the message go to the endpoint configured on this server, never to the Meta Model API.";
    }
  }
}

/**
 * Engine selector: Muse Spark 1.3 (Model API) / Run privately (open weights) / Muse via OpenRouter
 * (test, only when its key is set) / Demo mode, as radio cards (native radios, so arrow keys and
 * screen readers behave as expected; the chosen card also shows a tick, never colour alone).
 * An option the server cannot honour stays selectable but says so, and a line below states
 * what the report will really run as, so a mock answer is never mistaken for Muse.
 */
export function EngineSwitch({
  value,
  onChange,
  availability,
  hasAccess = true,
  name = "engine",
}: {
  value: Engine;
  onChange: (engine: Engine) => void;
  availability: EngineAvailability;
  /** False when the server asks for an access code and none was typed. */
  hasAccess?: boolean;
  name?: string;
}) {
  const options = engineOptions(availability);
  const willRunAs = effectiveEngine(value, availability, hasAccess);
  const needsCode = availability.accessCodeRequired === true && !hasAccess;
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Engine</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((o) => {
          const selected = o.value === value;
          const Icon = ENGINE_ICON[o.value];
          return (
            <label
              key={o.value}
              className={cn(
                "relative flex min-h-11 cursor-pointer gap-3 rounded-xl border bg-surface p-3.5 text-sm",
                "transition-[border-color,box-shadow,background-color] duration-200 motion-reduce:transition-none",
                "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
                selected ? "border-ink bg-surface-muted shadow-card ring-1 ring-ink" : "border-border hover:border-border-strong",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={selected}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
                  selected ? "bg-ink text-white" : "bg-surface-muted text-ink ring-1 ring-inset ring-border",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="font-medium leading-5 text-foreground">{o.label}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-200",
                      selected ? "border-ink bg-ink text-white" : "border-border-strong bg-surface",
                    )}
                  >
                    {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </span>
                <span className="text-xs leading-5 text-muted">{o.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
        This report will run as{" "}
        {needsCode ? (
          // The server takes no report at all without the code (demo mode included), so there is no
          // engine to name yet: the DEMO MODE badge here read as "this will run in demo mode" and
          // sat next to "nothing is accepted" (final review of 27 Oct 2026).
          <>
            <span
              data-testid="needs-access-code"
              className="inline-flex items-center whitespace-nowrap rounded-full bg-warning-soft px-3 py-1 text-xs font-semibold text-warning"
            >
              Needs the access code
            </span>
            <span className="text-muted">(nothing is accepted until you enter the access code of this demo)</span>
          </>
        ) : (
          <>
            <EngineBadge engine={willRunAs} detail={detailFor(willRunAs, availability)} />
            {willRunAs === "demo-mock" && value !== "demo-mock" && (
              <span className="text-muted">(the requested engine is not configured on this server)</span>
            )}
          </>
        )}
      </p>
      {!needsCode && (
        <p data-testid="photo-destination" className="mt-1.5 text-xs leading-5 text-muted">
          <span className="font-medium text-foreground">Where your photos go: </span>
          {photoDestination(willRunAs, availability)}
        </p>
      )}
    </fieldset>
  );
}
