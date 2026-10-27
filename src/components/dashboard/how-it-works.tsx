import { ChevronRight, FilePen, Scale, ScanEye, SquareDashed, type LucideIcon } from "lucide-react";

const STEPS: { label: string; icon: LucideIcon }[] = [
  { label: "Read photo", icon: ScanEye },
  { label: "Outline damage", icon: SquareDashed },
  { label: "Apply carrier rules", icon: Scale },
  { label: "Draft claim", icon: FilePen },
];

/** One line that says what happens between a customer's photo and a claim waiting for your click. */
export function HowItWorks() {
  return (
    <section
      aria-label="How Gilmend works"
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface/70 px-5 py-4 lg:flex-row lg:items-center lg:gap-8"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">How Gilmend works</p>
      <ol className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-2">
        {STEPS.map(({ label, icon: Icon }, i) => (
          <li key={label} className="flex items-center gap-2.5 text-sm font-medium text-ink-soft sm:gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
            </span>
            {label}
            {i < STEPS.length - 1 && (
              <ChevronRight aria-hidden="true" className="ml-1 hidden h-4 w-4 text-border-strong sm:block" />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
