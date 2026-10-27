import { RoiCalculator } from "@/components/impact/roi-calculator";
import { SourcesSection } from "@/components/impact/sources-section";
import { measureAgentTime, type MeasuredTime } from "@/lib/impact/measured-time";
import { listShowcaseCases } from "@/lib/showcase/showcase";

// The agent's time is read from the committed recorded runs when the page is rendered, so the
// number always matches the recordings that ship with the code.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Impact",
  description:
    "What damaged parcels cost a merchant in a year, how much carrier compensation a missed deadline loses, and what Gilmend gets back. Every assumption is visible and editable.",
};

/** The gold seam under the title: draws itself once (src/app/globals.css, `animate-seam`). */
function Seam() {
  return (
    <svg aria-hidden="true" width="132" height="12" viewBox="0 0 132 12" fill="none" className="mt-4">
      <path
        d="M2 6.5 34 6.5 41 2.5 56 9.5 66 5 129 5"
        stroke="var(--gold)"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="140"
        className="animate-seam"
        style={{ ["--seam-length" as string]: 140 }}
      />
    </svg>
  );
}

export default async function ImpactPage() {
  let measured: MeasuredTime | null = null;
  try {
    measured = measureAgentTime(await listShowcaseCases());
  } catch (err) {
    // An unreadable showcase must not break the calculator: the page then says the time is not measured.
    console.error("[gilmend] reading the recorded runs failed:", err instanceof Error ? err.message : err);
  }
  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <header className="animate-rise max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Impact</p>
        <h1 className="mt-3 font-display text-4xl leading-[1.05] tracking-tight text-ink sm:text-5xl">
          What a damaged parcel costs, and what a deadline takes
        </h1>
        <Seam />
        <p className="mt-5 text-base leading-7 text-muted">
          Enter your own numbers. Carrier amounts and deadlines come from the same code that prepares a claim, run on your
          figures; the time Gilmend takes is measured on real recorded runs. Everything else is a labelled assumption you
          can change. This is an estimate, not a promise: carriers decide what they pay.
        </p>
      </header>
      <RoiCalculator measured={measured} />
      <SourcesSection measured={measured} />
    </div>
  );
}
