import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Presentational pieces shared by the case page (src/components/case-*.tsx). No logic, no data
// shapes: panels, small facts, status pills and notes in the Gilmend design system
// (docs/design.md). Gold is never used here: it is reserved for money.

/** Staggered entrance (animate-rise, 40 ms apart); switched off for reduced motion in globals.css. */
export function riseStyle(index: number): CSSProperties {
  return { animationDelay: `${index * 40}ms` };
}

/** Class sets for buttons and links that look like buttons. All are at least 44 px tall. */
export const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-[background-color,box-shadow,transform,opacity] duration-200 ease-out active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";
export const BUTTON_PRIMARY = cn(BUTTON_BASE, "bg-ink text-white shadow-card hover:bg-ink-soft");
export const BUTTON_SECONDARY = cn(
  BUTTON_BASE,
  "border border-border-strong bg-surface text-ink hover:bg-surface-muted",
);
export const BUTTON_QUIET = cn(
  BUTTON_BASE,
  "min-h-11 border border-border bg-surface px-3 text-ink hover:border-border-strong hover:bg-surface-muted pointer-fine:min-h-9",
);
export const BUTTON_DANGER = cn(BUTTON_BASE, "text-danger hover:bg-danger-soft");

export function BackLink({ href = "/", children = "All cases" }: { href?: string; children?: ReactNode }) {
  return (
    <Link
      href={href}
      className="group -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted transition-colors hover:text-ink"
    >
      <ArrowLeft
        aria-hidden="true"
        className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5"
        strokeWidth={1.75}
      />
      {children}
    </Link>
  );
}

/** Small uppercase label used above values and as the quiet title of the decision card. */
export function Eyebrow({ children, className, ...props }: ComponentProps<"p">) {
  return (
    <p className={cn("text-xs font-semibold uppercase tracking-[0.14em] text-muted", className)} {...props}>
      {children}
    </p>
  );
}

/** A card with an icon tile, a title and an optional action on the right. */
export function Panel({
  id,
  title,
  icon: Icon,
  action,
  children,
  index = 0,
  className,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  /** Position in the page, for the staggered entrance. */
  index?: number;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      style={riseStyle(index)}
      className={cn("animate-rise rounded-2xl border border-border bg-surface shadow-card", className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 items-center gap-3">
          <IconTile icon={Icon} />
          <h2 id={id} className="text-base font-semibold tracking-tight text-ink">
            {title}
          </h2>
        </div>
        {action}
      </header>
      <div className="px-5 pb-5 pt-4 sm:px-6 sm:pb-6">{children}</div>
    </section>
  );
}

export function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-muted text-ink-soft",
        className,
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </span>
  );
}

/** A label above a value, for the dl grids of the order, the assessment and the claim. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="mt-1 break-words text-sm leading-snug text-ink">{children}</dd>
    </div>
  );
}

export type Tone = "ok" | "warn" | "danger" | "neutral" | "info";

const TONE: Record<Tone, string> = {
  ok: "border-success/20 bg-success-soft text-success",
  warn: "border-warning/25 bg-warning-soft text-warning",
  danger: "border-danger/20 bg-danger-soft text-danger",
  neutral: "border-border bg-surface-muted text-ink-soft",
  info: "border-accent/15 bg-accent-soft text-accent",
};

/** A status or flag: always an icon and a word, never colour alone. */
export function Pill({
  tone = "neutral",
  icon: Icon,
  children,
  className,
  ...props
}: { tone?: Tone; icon?: LucideIcon; children: ReactNode } & ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-normal rounded-full border px-2.5 py-1 text-left text-xs font-semibold leading-tight",
        TONE[tone],
        className,
      )}
      {...props}
    >
      {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
      {children}
    </span>
  );
}

const NOTE_TONE: Record<"warn" | "info" | "neutral", { box: string; icon: string }> = {
  warn: { box: "border-warning/25 bg-warning-soft", icon: "bg-surface text-warning" },
  info: { box: "border-border-strong bg-surface-muted", icon: "bg-surface text-accent" },
  neutral: { box: "border-border bg-surface-muted", icon: "bg-surface text-ink-soft" },
};

/** An elegant callout for the honesty banners (demo mode, recorded run, unfinished case). */
export function Note({
  tone = "info",
  icon: Icon,
  children,
  className,
  ...props
}: { tone?: "warn" | "info" | "neutral"; icon: LucideIcon; children: ReactNode } & ComponentProps<"div">) {
  const t = NOTE_TONE[tone];
  return (
    <div
      role="note"
      className={cn("flex items-start gap-3 rounded-2xl border p-4 sm:p-5", t.box, className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border", t.icon)}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <p className="min-w-0 pt-1 text-sm leading-relaxed text-ink-soft [&_strong]:font-semibold [&_strong]:text-ink">
        {children}
      </p>
    </div>
  );
}
