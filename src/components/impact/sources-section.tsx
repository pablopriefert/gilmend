import Link from "next/link";
import { ExternalLink, FlaskConical, History, ShieldCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { windowLabel, reserveLabel, CARRIER_ORDER } from "@/lib/impact/insights";
import type { MeasuredTime } from "@/lib/impact/measured-time";
import { FIELDS } from "@/lib/impact/roi";
import { IMPACT_SOURCES } from "@/lib/impact/sources";
import { getCarrierRulesDetailed, rulesLastReviewed } from "@/lib/rules/carriers";
import type { FigureStatus } from "@/lib/rules/schema";
import type { CarrierId } from "@/lib/types";
import { CARRIER_LABEL, DECISION_LABEL, formatDate, formatEur } from "../format";

// Where every number of /impact comes from. The page is only credible if a reader can check the
// inputs, so each kind of number has a block: measured here, from the carriers' terms, from the
// public record, and assumed. Nothing in this file computes money; it prints what the rules and the
// sources say.

const STATUS: Record<FigureStatus, { label: string; icon: LucideIcon; className: string }> = {
  verified: { label: "verified", icon: ShieldCheck, className: "text-success" },
  dated_source: { label: "dated source", icon: History, className: "text-warning" },
  unverified: { label: "unverified", icon: TriangleAlert, className: "text-warning" },
};

function Block({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
      <h3 id={`${id}-title`} className="text-base font-semibold tracking-tight text-ink">
        {title}
      </h3>
      <p className="mt-0.5 max-w-3xl text-sm leading-5 text-muted">{intro}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ExternalA({ href, children, lang }: { href: string; children: ReactNode; lang?: string }) {
  return (
    <a
      href={href}
      lang={lang}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:decoration-accent"
    >
      {children}
      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
    </a>
  );
}

function describePay(carrier: CarrierId): string {
  const { compensation: c } = getCarrierRulesDetailed(carrier);
  const parts: string[] = [];
  if (c.flatEur !== undefined) parts.push(`${formatEur(c.flatEur)} per parcel`);
  if (c.perKgEur !== undefined) parts.push(`${formatEur(c.perKgEur)} per kg`);
  return `${parts.join(" or ")}, capped at ${formatEur(c.capEur)}`;
}

function MeasuredBlock({ measured }: { measured: MeasuredTime | null }) {
  const samRuns = measured ? measured.runs.filter((r) => r.withSam).length : 0;
  return (
    <Block
      id="src-measured"
      title="Measured: the agent's time per case"
      intro="The only time figure that is a measurement. It is the span between the first and the last step of each recorded run's trace."
    >
      {measured === null ? (
        <p data-testid="measured-none" className="text-sm text-muted">
          No recorded run was found on this server, so the agent&apos;s own time is not measured and is left out of the
          calculator.
        </p>
      ) : (
        <>
          <table className="w-full max-w-xl border-collapse text-left text-sm">
            <caption className="sr-only">Duration of each recorded run</caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">Recorded run</th>
                <th scope="col" className="px-3 py-2 font-semibold">Decision</th>
                <th scope="col" className="px-3 py-2 font-semibold">SAM outline</th>
                <th scope="col" className="py-2 pl-3 text-right font-semibold">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {measured.runs.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="py-2 pr-3 font-medium text-ink">
                    <Link
                      href={`/cases/${r.id}`}
                      className="rounded underline decoration-border-strong underline-offset-2 hover:decoration-ink"
                    >
                      {r.orderId}
                    </Link>
                  </th>
                  <td className="px-3 py-2 text-ink-soft">
                    {r.decision && r.decision in DECISION_LABEL ? DECISION_LABEL[r.decision as keyof typeof DECISION_LABEL] : "No decision"}
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{r.withSam ? "Yes" : "No"}</td>
                  <td className="tabular py-2 pl-3 text-right text-ink">{r.seconds.toFixed(1)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p data-testid="measured-summary" className="tabular mt-4 text-sm text-ink-soft">
            Mean {measured.meanSeconds.toFixed(1)} s, median {measured.medianSeconds.toFixed(1)} s, from{" "}
            {measured.minSeconds.toFixed(1)} s to {measured.maxSeconds.toFixed(1)} s, over {measured.runs.length} real{" "}
            {measured.runs.length === 1 ? "run" : "runs"} of Muse Spark 1.3, {samRuns} of them with a SAM 3.1 outline,
            recorded on {formatDate(`${measured.recordedOn}T12:00:00Z`)}.
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-muted">
            What this is not: a benchmark. Scripted scenarios with generated photos, one run each, recorded on one day. Real
            photos, a busy API and a long thread will take longer. It includes the model calls and the SAM outline when one was
            drawn, not the time you spend reading the case.
          </p>
        </>
      )}
    </Block>
  );
}

function RulesBlock() {
  return (
    <Block
      id="src-rules"
      title="From the carriers' public terms"
      intro={`The amounts and windows the calculator uses are read from data/carriers.json by the rule code of the app, last reviewed ${formatDate(
        `${rulesLastReviewed()}T12:00:00Z`,
      )}. These are standard professional terms: a negotiated contract may differ.`}
    >
      <div role="region" aria-label="Carrier terms" tabIndex={0} className="-mx-1 overflow-x-auto rounded-lg px-1">
        <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
          <caption className="sr-only">What each carrier pays, when its window closes, and how sure we are of each figure</caption>
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">Carrier</th>
              <th scope="col" className="px-3 py-2 font-semibold">Pays</th>
              <th scope="col" className="px-3 py-2 font-semibold">Claim window</th>
              <th scope="col" className="px-3 py-2 font-semibold">Reserve window</th>
              <th scope="col" className="py-2 pl-3 font-semibold">Figures and sources</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {CARRIER_ORDER.map((carrier) => {
              const rules = getCarrierRulesDetailed(carrier);
              const counts = (["verified", "dated_source", "unverified"] as const)
                .map((status) => ({ status, n: rules.figures.filter((f) => f.status === status).length }))
                .filter((c) => c.n > 0);
              return (
                <tr key={carrier} data-testid={`rules-${carrier}`} className="align-top">
                  <th scope="row" className="py-3 pr-3 font-medium text-ink">{CARRIER_LABEL[carrier]}</th>
                  <td className="px-3 py-3 text-ink-soft">{describePay(carrier)}</td>
                  <td className="px-3 py-3 text-ink-soft">{windowLabel(carrier)}</td>
                  <td className="px-3 py-3 text-ink-soft">{reserveLabel(carrier)}</td>
                  <td className="py-3 pl-3">
                    <ul className="flex flex-col gap-1 text-xs">
                      {counts.map(({ status, n }) => {
                        const { label, icon: Icon, className } = STATUS[status];
                        return (
                          <li key={status} className={`flex items-center gap-1.5 font-medium ${className}`}>
                            <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                            {n} {label}
                          </li>
                        );
                      })}
                      {rules.sources.slice(0, 2).map((s) => (
                        <li key={s.url}>
                          <ExternalA href={s.url}>{s.title.split(" (")[0].split(",")[0]}</ExternalA>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

function RecordBlock() {
  return (
    <Block
      id="src-record"
      title="From the public record"
      intro="What we found when we looked for an industry damage rate, and why the calculator does not use one."
    >
      <ul className="flex flex-col divide-y divide-border">
        {IMPACT_SOURCES.map((s) => (
          <li key={s.id} data-testid={`source-${s.id}`} className="py-4 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-ink">
              <ExternalA href={s.url} lang={s.language}>{s.title}</ExternalA>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {s.publisher}, published {formatDate(`${s.publishedOn}T12:00:00Z`)}, read {formatDate(`${s.checkedOn}T12:00:00Z`)}.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-ink-soft">
              {s.figures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-muted">
              <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span>{s.caveat}</span>
            </p>
          </li>
        ))}
      </ul>
    </Block>
  );
}

function AssumptionsBlock() {
  const assumptions = FIELDS.filter((f) => f.kind === "assumption");
  return (
    <Block
      id="src-assumed"
      title="Assumed: yours to change"
      intro="Nobody measured these for your shop. They are labelled Assumption in the form, and every one of them can be edited."
    >
      <ul data-testid="assumed-list" className="grid gap-x-8 gap-y-2 text-sm text-ink-soft sm:grid-cols-2">
        {assumptions.map((f) => (
          <li key={f.key} className="flex items-start gap-2">
            <FlaskConical aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} />
            {f.label}
          </li>
        ))}
      </ul>
    </Block>
  );
}

/** The four blocks under the calculator: measured, carrier terms, public record, assumed. */
export function SourcesSection({ measured }: { measured: MeasuredTime | null }) {
  return (
    <section aria-labelledby="sources-title" className="flex flex-col gap-5">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Where the numbers come from</p>
        <h2 id="sources-title" className="mt-2 font-display text-2xl leading-tight tracking-tight text-ink sm:text-3xl">
          Measured, sourced or assumed. Never invented.
        </h2>
      </div>
      <MeasuredBlock measured={measured} />
      <RulesBlock />
      <RecordBlock />
      <AssumptionsBlock />
    </section>
  );
}
