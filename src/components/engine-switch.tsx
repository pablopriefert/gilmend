"use client";

import type { Engine } from "@/lib/types";
import { EngineBadge } from "./engine-badge";
import { detailFor, effectiveEngine, engineOptions, type EngineAvailability } from "./engine-choice";

/**
 * Engine selector: Muse Spark 1.3 (Model API) / Run privately (open weights) / Muse via OpenRouter
 * (test, only when its key is set) / Demo mode.
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
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium">Engine</legend>
      <div className={`grid gap-2 ${options.length > 3 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <label
              key={o.value}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
                selected ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-muted"
              }`}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name={name}
                  value={o.value}
                  checked={selected}
                  onChange={() => onChange(o.value)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                {o.label}
              </span>
              <span className="text-xs text-muted">{o.description}</span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
        This report will run as <EngineBadge engine={willRunAs} detail={detailFor(willRunAs, availability)} />
        {willRunAs === "demo-mock" && value !== "demo-mock" && (
          <span className="text-muted">
            {availability.accessCodeRequired && !hasAccess
              ? "(a real engine needs the access code of this demo)"
              : "(the requested engine is not configured on this server)"}
          </span>
        )}
      </p>
    </fieldset>
  );
}
