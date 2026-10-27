import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A card of the Insights band: a title, one line saying what the figures mean, then the chart.
 * The title is an h3 under the section's h2, and the card is a labelled region so a screen reader
 * can jump from one chart to the next.
 */
export function Panel({
  id,
  title,
  description,
  className,
  children,
}: {
  id: string;
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn("flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6", className)}
    >
      <header>
        <h3 id={`${id}-title`} className="text-base font-semibold leading-6 tracking-tight text-ink">
          {title}
        </h3>
        <p className="mt-0.5 text-sm leading-5 text-muted">{description}</p>
      </header>
      {children}
    </section>
  );
}
