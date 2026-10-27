import { ReportForm } from "@/components/report-form";
import { describeEngine, hasModelKey, hasOpenRouterKey, hasOpenWeightsConfig } from "@/lib/config";
import { accessCodeRequired } from "../api/_lib/access";

// Reads the server environment to say honestly which engines are configured.
export const dynamic = "force-dynamic";

export const metadata = { title: "New report" };

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

export default function ReportPage() {
  const openWeights = hasOpenWeightsConfig();
  const openRouter = hasOpenRouterKey();
  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <header className="animate-rise max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">New report</p>
        <h1 className="mt-3 font-display text-4xl leading-[1.05] tracking-tight text-ink sm:text-5xl">
          Report a damaged parcel
        </h1>
        <Seam />
        <p className="mt-5 text-base leading-7 text-muted">
          This simulates the e-mail or chat message a customer sends. The agent looks up the order, reads the photos,
          decides and prepares the carrier claim. Nothing is sent to anyone.
        </p>
      </header>
      <ReportForm
        availability={{
          museKey: hasModelKey(),
          openWeights,
          openWeightsDetail: openWeights ? describeEngine("open-weights") : undefined,
          openRouter,
          openRouterDetail: openRouter ? describeEngine("openrouter") : undefined,
          accessCodeRequired: accessCodeRequired(),
        }}
      />
    </div>
  );
}
