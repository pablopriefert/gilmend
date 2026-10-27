import { CalendarClock, Clapperboard, Coins, FlaskConical, Info } from "lucide-react";
import type { CSSProperties } from "react";
import type { CaseRecord } from "@/lib/types";
import { summarizeCases, summarizeRecordedRuns } from "@/lib/store/summary";
import AnimatedCounter from "./arc/animated-counter/animated-counter";
import { formatDate, formatEur } from "./format";
import { BorderBeam } from "./ui/border-beam";

// The Arc counter sizes and colours itself from these two variables (its CSS module reads
// --text-3xl and --foreground), so a wrapper can make it big and gold without touching Arc.
const HERO_FIGURE = { "--text-3xl": "clamp(3.75rem, 8vw, 6rem)", "--foreground": "var(--gold-ink)" } as CSSProperties;
// Gold means money to recover (docs/design.md). A fresh deployment has none yet: its zero is
// muted instead of shining gold as the first thing a visitor sees.
const HERO_FIGURE_EMPTY = { ...HERO_FIGURE, "--foreground": "var(--muted)" } as CSSProperties;
const FIGURE = { "--text-3xl": "clamp(2.5rem, 6vw, 3.25rem)" } as CSSProperties;

function Label({ icon: Icon, children }: { icon: typeof Coins; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm font-medium text-muted">
      <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
      {children}
    </p>
  );
}

/**
 * Page title plus the hero band: "€1,240 recoverable this month · 3 claims due this week".
 * The figures are drawn with Arc's animated counter inside a slow gold Border Beam (21st.dev).
 * The animated digits are hidden from assistive technology; the same sentence the old header
 * showed is kept as plain text (`counter`, `recorded-counter`) so a screen reader gets one
 * clear figure instead of ten rolling digits. The labels and the two honesty notes (what the
 * amount means, which runs are recorded or demo) are visible text, never inside that hidden part.
 */
export function CasesHeader({ cases, now }: { cases: CaseRecord[]; now: Date }) {
  const { recoverableThisMonthEur: recoverableEur, claimsDueThisWeek, demoModeCases } = summarizeCases(cases, now);
  const recorded = summarizeRecordedRuns(cases);
  const recordedCases = recorded.count;
  const showRecorded = recordedCases > 0 && recorded.asOf !== null;
  const asOf = recorded.asOf ? formatDate(`${recorded.asOf}T12:00:00Z`) : "";
  return (
    <section aria-labelledby="cases-title" className="flex flex-col gap-8">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Claims desk</p>
        <h1 id="cases-title" className="mt-3 font-display text-4xl leading-[1.05] tracking-tight text-ink sm:text-5xl">
          Cases
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
          Every damaged-parcel report, what the agent decided, and the carrier claim waiting for your click.
        </p>
      </div>

      <p data-testid="counter" className="sr-only">
        {`${formatEur(recoverableEur)} recoverable this month · ${claimsDueThisWeek} ${
          claimsDueThisWeek === 1 ? "claim" : "claims"
        } due this week`}
      </p>
      {showRecorded && (
        // A second figure, not part of the one above: on a fresh deployment the live counter
        // reads 0 because the recorded runs are not counted, and this is what they found.
        <p data-testid="recorded-counter" className="sr-only">
          {`Recorded runs: ${formatEur(recorded.recoverableEur, { whole: false })} recoverable (as of ${asOf})`}
        </p>
      )}

      <BorderBeam color="var(--gold)" length={16} thickness={1.5} speed={11} className="rounded-2xl">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-raised">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-20 -top-28 h-72 w-[32rem] max-w-full rounded-full bg-gold-bright/25 blur-3xl"
          />
          <div
            aria-hidden="true"
            // Two columns from tablet width (the recorded card then spans a second row), three from
            // laptop width. Cell borders instead of divide-*, so the spanning card gets the right ones.
            className={`relative grid ${
              showRecorded ? "md:grid-cols-2 lg:grid-cols-[1.45fr_1fr_1fr]" : "md:grid-cols-[1.45fr_1fr]"
            }`}
          >
            <div className="p-6 sm:p-8">
              <Label icon={Coins}>Recoverable this month</Label>
              <div className="mt-5" style={recoverableEur > 0 ? HERO_FIGURE : HERO_FIGURE_EMPTY}>
                {/* Cents shown whenever there are any: rounding 52.90 up to 53 would overstate the claim. */}
                <AnimatedCounter value={recoverableEur} prefix="€" decimals={Number.isInteger(recoverableEur) ? 0 : 2} animateOnView />
              </div>
              <p className="mt-4 text-sm text-muted">Maximum under each carrier&apos;s rules, live cases only.</p>
            </div>
            <div className="border-t border-border p-6 sm:p-8 md:border-l md:border-t-0">
              <Label icon={CalendarClock}>Claims due this week</Label>
              <div className="mt-5" style={FIGURE}>
                <AnimatedCounter value={claimsDueThisWeek} animateOnView />
              </div>
              <p className="mt-4 text-sm text-muted">
                {claimsDueThisWeek > 0
                  ? "Carrier deadlines in the next 7 days."
                  : "No carrier deadline in the next 7 days."}
              </p>
            </div>
            {showRecorded && (
              <div className="border-t border-border bg-surface-muted/70 p-6 sm:p-8 md:col-span-2 lg:col-span-1 lg:border-l lg:border-t-0">
                <Label icon={Clapperboard}>Recorded runs</Label>
                <div className="mt-5" style={FIGURE}>
                  <AnimatedCounter value={recorded.recoverableEur} prefix="€" decimals={2} animateOnView />
                </div>
                <p className="mt-4 text-sm text-muted">
                  {recordedCases} real Muse {recordedCases === 1 ? "run" : "runs"}, as of {asOf}.
                </p>
              </div>
            )}
          </div>
          <div className="relative flex flex-col gap-2 border-t border-border bg-surface-muted px-6 py-4 text-xs leading-relaxed text-muted sm:px-8 sm:text-[13px]">
            <p className="flex items-start gap-2">
              <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span>
                Maximum compensation under each carrier&apos;s rules, for claims the agent found eligible and you
                have not rejected. Not a promise of payment.
              </span>
            </p>
            {recordedCases > 0 && (
              <p className="flex items-start gap-2">
                <Clapperboard aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span data-testid="recorded-note">
                  {recordedCases} recorded {recordedCases === 1 ? "run" : "runs"} (real Muse runs saved with the code)
                  {recordedCases === 1 ? " is" : " are"} listed below but not counted in the live counter.
                </span>
              </p>
            )}
          </div>
        </div>
      </BorderBeam>

      {demoModeCases > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-5 py-4 text-warning">
          <FlaskConical aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
          <p data-testid="demo-mode-note" className="text-sm font-medium leading-relaxed">
            Includes {demoModeCases} demo-mode {demoModeCases === 1 ? "case" : "cases"}: scripted decisions,
            not Muse.
          </p>
        </div>
      )}
    </section>
  );
}
