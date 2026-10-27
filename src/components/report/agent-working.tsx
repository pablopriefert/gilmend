"use client";

import { useEffect, useState } from "react";
import { Calculator, Check, FileText, LoaderCircle, ScanEye, Scale, Shapes } from "lucide-react";
import { EngineBadge } from "../engine-badge";
import type { Engine } from "@/lib/types";
import { cn } from "@/lib/utils";

// The working state of the report form (Gilmend redesign, 27 Oct 2026).
//
// HONESTY: POST /api/reports answers once, when the case is finished (no streaming, no
// progress events). So the five steps below are an ILLUSTRATION of what the agent goes through,
// advanced by a timer tuned to a real run (about 54 s on Muse Spark 1.3 on 27 Oct 2026). The
// panel says so in words. The only live figure on it is the real elapsed time.

export const AGENT_STEPS = [
  { key: "photos", label: "Reading the photos", detail: "What is broken, and is it the item or only the box?", icon: ScanEye, at: 0 },
  { key: "sam", label: "Outlining the damage with SAM 3.1", detail: "The annotated photo that goes into the claim.", icon: Shapes, at: 12 },
  { key: "rules", label: "Checking carrier rules", detail: "Deadline, cap and proof, from dated public terms.", icon: Scale, at: 24 },
  { key: "claim", label: "Computing the claim", detail: "The amount comes from code, never from the model.", icon: Calculator, at: 31 },
  { key: "draft", label: "Drafting the claim and the reply", detail: "A PDF, an e-mail to the carrier, a reply to the customer.", icon: FileText, at: 38 },
] as const;

/** Steps that, on a real run, are model calls: in DEMO MODE they are scripted, and the panel says so. */
const MODEL_STEPS: ReadonlySet<string> = new Set(["photos", "sam", "draft"]);

/** Index of the step the illustration is on after `seconds` (the last one stays until the answer). */
export function stepAt(seconds: number): number {
  let current = 0;
  AGENT_STEPS.forEach((step, i) => {
    if (seconds >= step.at) current = i;
  });
  return current;
}

export function AgentWorking({ engine, variant = "report" }: { engine: Engine; variant?: "report" | "follow-up" }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const active = stepAt(seconds);
  const mock = engine === "demo-mock";
  // A thread fills with the steps: decorative. Ink, not gold: gold is for money.
  const seamFraction = (active + 0.5) / AGENT_STEPS.length;

  return (
    <div
      data-testid="agent-working"
      className="animate-rise absolute inset-0 z-20 rounded-[inherit] bg-surface/90 backdrop-blur-[3px]"
    >
      <div className="sticky top-[max(1.5rem,12vh)] mx-auto flex max-w-md flex-col gap-6 px-5 py-8 sm:px-8">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <EngineBadge engine={engine} />
            <span className="tabular text-xs text-muted" aria-hidden="true">
              {seconds} s
            </span>
          </div>
          <h2 className="font-display text-3xl leading-tight tracking-tight text-foreground">
            {variant === "follow-up" ? "The agent is re-reading the case" : "The agent is on your report"}
          </h2>
          <p className="text-sm leading-6 text-muted">
            {mock
              ? "DEMO MODE: canned answers, no model is called, so this is quick."
              : variant === "follow-up"
                ? "A real run on the model usually takes 40 to 60 seconds, with the earlier photos and the new ones. Keep this page open: the case updates by itself."
                : "A real run on the model usually takes 40 to 60 seconds. Keep this page open: the case opens by itself."}
          </p>
        </div>

        <ol aria-label="Steps the agent goes through (illustration)" className="relative flex flex-col gap-1">
          {/* A hairline track, and an ink thread drawn down it as the steps advance. */}
          <span aria-hidden="true" className="absolute bottom-5 left-[1.0625rem] top-5 w-px bg-border" />
          <span
            aria-hidden="true"
            className="absolute left-[1.0625rem] top-5 w-px bg-ink transition-[height] duration-700 ease-out motion-reduce:transition-none"
            style={{ height: `calc((100% - 2.5rem) * ${seamFraction})` }}
          />
          {AGENT_STEPS.map((step, i) => {
            const done = i < active;
            const current = i === active;
            const Icon = step.icon;
            return (
              <li
                key={step.key}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "relative flex items-start gap-3 py-2 transition-opacity duration-300",
                  !done && !current && "opacity-75",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative z-10 mt-0.5 inline-flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
                    done && "border-ink bg-ink text-white",
                    current && "border-ink bg-surface text-ink shadow-card",
                    !done && !current && "border-border-strong bg-surface text-muted",
                  )}
                >
                  {done ? (
                    <Check className="h-4 w-4" strokeWidth={2.25} />
                  ) : current ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:hidden" strokeWidth={2} />
                      <Icon className="hidden h-4 w-4 motion-reduce:block" strokeWidth={1.75} />
                    </>
                  ) : (
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  )}
                </span>
                <span className="min-w-0 pt-1">
                  <span className={cn("block text-sm leading-5 text-foreground", current ? "font-semibold" : "font-medium")}>
                    {step.label}
                    {mock && MODEL_STEPS.has(step.key) && (
                      <span className="font-normal text-muted"> (scripted, no model call)</span>
                    )}
                    <span className="sr-only">{done ? " (done)" : current ? " (in progress)" : " (waiting)"}</span>
                  </span>
                  {current && <span className="mt-0.5 block text-xs leading-5 text-muted">{step.detail}</span>}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="rounded-lg border border-border bg-surface-muted px-3.5 py-2.5 text-xs leading-5 text-muted">
          These steps illustrate what the agent does. They are not live progress: the app only learns the result when the
          case is finished.
        </p>
      </div>
    </div>
  );
}
