import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// Presentational pieces of the report form (Gilmend redesign, 27 Oct 2026): a grouped card
// section, a labelled field with its hint and inline error, and the shared input style.
// Nothing here knows about the report: it only lays things out.

/** 44 px tall (touch target), hairline border, ink focus: the one text-input style of the form. */
export const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-border-strong/70 bg-surface px-3.5 text-[0.9375rem] text-foreground shadow-[inset_0_1px_0_rgb(21_22_28_/_0.02)] " +
  "placeholder:text-muted transition-[border-color,box-shadow] duration-150 " +
  "hover:border-border-strong focus:border-ink " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-soft/40";

/** An error line: icon + words (never colour alone), announced when it appears. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-sm text-danger">
      <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
      <span>{children}</span>
    </p>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs leading-5 text-muted">
          {hint}
        </p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

/**
 * One group of the form card: a numbered step, a title, one line of help, then the content.
 * Groups are separated by a hairline; the number is tabular so the column never jitters.
 */
export function Section({
  step,
  title,
  description,
  id,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-5 px-5 py-6 sm:px-8 sm:py-7">
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="tabular mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white"
        >
          {step}
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-base font-semibold leading-6 tracking-tight text-foreground">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm leading-5 text-muted">{description}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}
