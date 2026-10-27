"use client";

import { CircleAlert, Clock3, RotateCcw, TriangleAlert, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { windowLabel } from "@/lib/impact/insights";
import type { MeasuredTime } from "@/lib/impact/measured-time";
import {
  bindingWindowHours,
  computeRoi,
  defaultRaw,
  FIELDS,
  GROUP_LABEL,
  validateRoiInputs,
  type CarrierRoi,
  type FieldGroup,
  type FieldKey,
  type FieldMeta,
  type RawInputs,
  type RoiResult,
} from "@/lib/impact/roi";
import { cn } from "@/lib/utils";
import { CARRIER_LABEL, formatEur } from "../format";
import { FieldError, INPUT_CLASS } from "../report/form-primitives";

// The ROI calculator of /impact. Every input is visible, editable and labelled as either the
// merchant's own figure (the default is an example) or an assumption; nothing is presented as a
// statistic. The money comes from src/lib/impact/roi.ts, which runs the app's own claim rules.

const GROUPS: FieldGroup[] = ["shop", "carriers", "claims", "time"];

function formatCount(n: number): string {
  if (n === 0) return "0";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n);
}

function formatMinutes(n: number): string {
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: Math.abs(n) < 10 ? 1 : 0 }).format(n)} min`;
}

function formatHours(n: number): string {
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(n)} h`;
}

function formatSeconds(n: number): string {
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(n)} s`;
}

function KindBadge({ kind }: { kind: FieldMeta["kind"] }) {
  const assumption = kind === "assumption";
  const Icon = assumption ? TriangleAlert : UserRound;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1",
        assumption ? "bg-warning-soft text-warning ring-warning/25" : "bg-accent-soft text-accent ring-accent/15",
      )}
    >
      <Icon aria-hidden="true" className="h-3 w-3" strokeWidth={2.25} />
      {assumption ? "Assumption" : "Your figure"}
    </span>
  );
}

/** The value, but only once it has stopped changing for `ms`: keeps a live region from announcing every keystroke. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** Announcements wait this long after the last keystroke. */
const ANNOUNCE_DELAY_MS = 900;

/** The id of a field's input, so the invalid-fields list can send the focus to it. */
const fieldId = (key: FieldKey) => `roi-field-${key}`;

function NumberField({
  meta,
  value,
  error,
  onChange,
}: {
  meta: FieldMeta;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = fieldId(meta.key);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {meta.label}
        </label>
        <KindBadge kind={meta.kind} />
      </div>
      <div className="relative">
        <input
          id={id}
          name={meta.key}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          className={cn(INPUT_CLASS, "tabular pr-24")}
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-muted">
          {meta.unit}
        </span>
      </div>
      <p id={hintId} className="text-xs leading-5 text-muted">
        {meta.hint}
      </p>
      {error && (
        <FieldError id={errorId} live="status">
          {error}
        </FieldError>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone = "ink",
  testId,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "ink" | "gold";
  testId?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd
        data-testid={testId}
        className={cn("tabular mt-0.5 font-display text-xl leading-tight", tone === "gold" ? "text-gold-ink" : "text-ink")}
      >
        {value}
      </dd>
      {note && <p className="mt-1 text-xs leading-5 text-muted">{note}</p>}
    </div>
  );
}

/** A bar scaled to the money available: gold for what is recovered, hatched for what a deadline took. */
function RecoveryBar({
  label,
  recoveredEur,
  lostEur,
  availableEur,
  detail,
  testId,
}: {
  label: string;
  recoveredEur: number;
  lostEur: number;
  availableEur: number;
  detail: string;
  testId: string;
}) {
  const recovered = availableEur > 0 ? (recoveredEur / availableEur) * 100 : 0;
  const lost = availableEur > 0 ? (lostEur / availableEur) * 100 : 0;
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="tabular text-sm font-semibold text-gold-ink">{`up to ${formatEur(recoveredEur)}`}</p>
      </div>
      <div aria-hidden="true" className="mt-2 flex h-3 overflow-hidden rounded-full bg-surface-muted ring-1 ring-border">
        <div className="h-full bg-gold" style={{ width: `${recovered}%` }} />
        <div
          className="h-full"
          style={{
            width: `${lost}%`,
            backgroundImage: "repeating-linear-gradient(45deg, var(--border-strong) 0 3px, transparent 3px 7px)",
          }}
        />
      </div>
      <p className="tabular mt-1.5 text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}

function outcomeText(c: CarrierRoi): string | null {
  switch (c.outcome) {
    case "late_filing":
      return "The window closes before the claim is filed by hand";
    case "late_report":
      return "The customer reports after the window: nothing to claim";
    case "refusal_needed":
      return "Only a parcel refused at delivery is paid, and none is assumed refused: nothing to claim";
    default:
      return null;
  }
}

function CarrierTable({ result }: { result: RoiResult }) {
  const { inputs } = result;
  const handAt = inputs.customerReportHours + inputs.manualFilingDelayDays * 24;
  const gilmendAt = inputs.customerReportHours + inputs.gilmendApprovalHours;
  return (
    <div
      role="region"
      aria-label="Per carrier"
      tabIndex={0}
      className="-mx-1 overflow-x-auto rounded-lg px-1"
    >
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Per carrier, per year: share of parcels, the maximum of one claim the carrier pays, what a claim filed by hand and
          one filed with Gilmend can recover, and what a deadline takes.
        </caption>
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <th scope="col" className="py-2 pr-3 font-semibold">Carrier</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Share</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">One claim</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">By hand</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">With Gilmend</th>
            <th scope="col" className="py-2 pl-3 text-right font-semibold">Lost by hand</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {result.carriers.map((c) => {
            const binding = bindingWindowHours(c.carrier);
            const note = outcomeText(c);
            return (
              <tr key={c.carrier} data-testid={`roi-carrier-${c.carrier}`} className="align-top">
                <th scope="row" className="py-3 pr-3 font-medium text-ink">
                  {CARRIER_LABEL[c.carrier]}
                  <span className="mt-0.5 block text-xs font-normal leading-5 text-muted">
                    {binding === null
                      ? `Window: ${windowLabel(c.carrier)}. The short reserve window only warns.`
                      : `Closes ${binding} h after delivery. Filed at ${Math.round(handAt)} h by hand, ${Math.round(gilmendAt)} h with Gilmend.`}
                    {c.payableSharePct < 100 &&
                      ` Pays only the ${formatCount(c.payableSharePct)}% of parcels refused at delivery.`}
                  </span>
                  {note && (
                    <span className="mt-1 flex items-start gap-1 text-xs font-medium leading-5 text-warning">
                      <Clock3 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                      {note}
                    </span>
                  )}
                </th>
                <td className="tabular px-3 py-3 text-right text-ink-soft">{formatCount(c.sharePct)}%</td>
                <td className="tabular px-3 py-3 text-right text-ink-soft">{formatEur(c.perClaimIfPaidEur)}</td>
                <td className="tabular px-3 py-3 text-right font-semibold text-gold-ink">{formatEur(c.byHandEur)}</td>
                <td className="tabular px-3 py-3 text-right font-semibold text-gold-ink">{formatEur(c.withGilmendEur)}</td>
                <td className={cn("tabular py-3 pl-3 text-right", c.lostByHandEur > 0 ? "font-semibold text-ink" : "text-muted")}>
                  {formatEur(c.lostByHandEur)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Results({ result, measured }: { result: RoiResult; measured: MeasuredTime | null }) {
  const { time, inputs } = result;
  const agentText = time.agentSecondsPerCase === null ? null : formatSeconds(time.agentSecondsPerCase);
  // Like the money gain, a negative saving is said as such instead of printed with a minus sign.
  const timeLost = time.savedMinutesPerCase < 0;
  return (
    <div className="flex flex-col gap-6">
      <p data-testid="roi-summary" className="text-sm leading-6 text-ink-soft">
        A shop with {formatCount(result.damagedPerYear)} damaged parcels a year has up to{" "}
        <strong className="tabular font-semibold text-gold-ink">{formatEur(result.availableEur)}</strong> of carrier
        compensation within reach. Filed by hand after {formatCount(inputs.manualFilingDelayDays)}{" "}
        {inputs.manualFilingDelayDays === 1 ? "day" : "days"}, up to{" "}
        <strong className="tabular font-semibold text-gold-ink">{formatEur(result.byHandEur)}</strong> of it is recovered;
        with Gilmend, up to <strong className="tabular font-semibold text-gold-ink">{formatEur(result.withGilmendEur)}</strong>.
      </p>

      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Stat testId="roi-damaged" label="Damaged parcels a year" value={formatCount(result.damagedPerYear)} />
        <Stat
          testId="roi-goods"
          label="Value of the damaged goods"
          value={formatEur(result.goodsValueEur)}
          note="What reshipping or refunding costs you before any claim."
        />
        <Stat
          testId="roi-available"
          label="Carrier compensation within reach"
          value={`up to ${formatEur(result.availableEur)}`}
          tone="gold"
          note={`${formatCount(result.claimsPerYear)} qualifying claims a year, filed at once.`}
        />
        <Stat
          testId="roi-gain"
          label="Gilmend compared with by hand"
          value={`${result.gainEur >= 0 ? "+" : "−"}${formatEur(Math.abs(result.gainEur))}`}
          tone="gold"
          note={
            result.gainEur >= 0
              ? "More recovered a year with Gilmend, at most."
              : "Less recovered with Gilmend: these numbers make its claim later than the one filed by hand."
          }
        />
      </dl>

      <div className="flex flex-col gap-5">
        <RecoveryBar
          testId="roi-bar-hand"
          label="By hand"
          recoveredEur={result.byHandEur}
          lostEur={result.lostByHandEur}
          availableEur={result.availableEur}
          detail={`Claim filed ${formatCount(inputs.manualFilingDelayDays)} ${
            inputs.manualFilingDelayDays === 1 ? "day" : "days"
          } after the report. Lost to deadlines: ${formatEur(result.lostByHandEur)}.`}
        />
        <RecoveryBar
          testId="roi-bar-gilmend"
          label="With Gilmend"
          recoveredEur={result.withGilmendEur}
          lostEur={result.lostWithGilmendEur}
          availableEur={result.availableEur}
          detail={`Claim filed ${formatCount(inputs.gilmendApprovalHours)} h after the report. Lost to deadlines: ${formatEur(
            result.lostWithGilmendEur,
          )}.`}
        />
        <p className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-4 rounded-sm bg-gold" /> Recovered, at most
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-4 rounded-sm ring-1 ring-border"
              style={{ backgroundImage: "repeating-linear-gradient(45deg, var(--border-strong) 0 2px, transparent 2px 5px)" }}
            />
            Lost to a deadline
          </span>
        </p>
      </div>

      <div data-testid="roi-time" className="border-t border-border pt-5">
        <h3 className="text-base font-semibold tracking-tight text-ink">Time per case</h3>
        <dl className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-3">
          <Stat testId="roi-time-hand" label="By hand" value={formatMinutes(time.manualMinutesPerCase)} note="Your assumption." />
          <Stat
            testId="roi-time-gilmend"
            label="With Gilmend"
            value={formatMinutes(time.gilmendMinutesPerCase)}
            note={
              agentText
                ? `Agent ${agentText}, measured on ${measured?.runs.length} recorded ${
                    measured?.runs.length === 1 ? "run" : "runs"
                  }, plus your ${formatMinutes(time.reviewMinutesPerCase)} (assumption).`
                : `Your ${formatMinutes(time.reviewMinutesPerCase)} (assumption). The agent's own time is not measured here: no recorded run was found on this server, so it is left out.`
            }
          />
          <Stat
            testId="roi-time-saved"
            label={timeLost ? "Extra time per case with Gilmend" : "Saved per case"}
            value={formatMinutes(Math.abs(time.savedMinutesPerCase))}
            note={
              timeLost
                ? "Your review time and the agent's time add up to more than the time by hand: with these numbers Gilmend does not save time."
                : undefined
            }
          />
        </dl>
        <p data-testid="roi-time-year" className="tabular mt-3 text-sm text-ink-soft">
          {formatHours(Math.abs(time.savedHoursPerYear))} {timeLost ? "more" : "saved"} a year, over{" "}
          {formatCount(result.damagedPerYear)} damaged parcels.
        </p>
      </div>

    </div>
  );
}

/**
 * The calculator: inputs on the left, results on the right (above the inputs on a phone). The
 * inputs are kept as the strings typed, so a half-typed number does not jump; the results appear
 * when every field is valid, and until then the page says which ones are not.
 */
export function RoiCalculator({ measured }: { measured: MeasuredTime | null }) {
  const [raw, setRaw] = useState<RawInputs>(defaultRaw);
  const validation = useMemo(() => validateRoiInputs(raw), [raw]);
  const result = useMemo(
    () => (validation.ok ? computeRoi(validation.inputs, measured) : null),
    [validation, measured],
  );
  const errors = validation.ok ? {} : validation.errors;
  const invalidKeys = FIELDS.map((f) => f.key).filter((k) => errors[k] !== undefined);
  const errorCount = invalidKeys.length;
  const isDefault = FIELDS.every((f) => raw[f.key] === defaultRaw()[f.key]);

  const shareTotal = (() => {
    const parts = (["shareColissimoPct", "shareMondialRelayPct", "shareChronopostPct"] as const).map((k) => Number(raw[k].replace(",", ".")));
    return parts.every((n) => Number.isFinite(n)) ? parts.reduce((a, b) => a + b, 0) : null;
  })();

  // One polite live region for the whole calculator, read once the person stops typing. The visible
  // summary and the invalid-fields box are not live themselves: they would be re-announced on every
  // keystroke.
  const announcement = useSettled(
    result
      ? `With these numbers: up to ${formatEur(result.withGilmendEur)} a year recovered with Gilmend, up to ${formatEur(result.byHandEur)} by hand.`
      : `${errorCount} ${errorCount === 1 ? "number is" : "numbers are"} not valid.`,
    ANNOUNCE_DELAY_MS,
  );

  function set(key: FieldKey, value: string) {
    setRaw((r) => ({ ...r, [key]: value }));
  }

  return (
    <div className="flex flex-col gap-8">
      <p data-testid="roi-announcement" role="status" className="sr-only">
        {announcement}
      </p>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <form
          aria-label="Your numbers"
          noValidate
          onSubmit={(e) => e.preventDefault()}
          className="order-2 flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface shadow-card lg:order-1"
        >
          {GROUPS.map((group) => (
            <fieldset key={group} className="flex min-w-0 flex-col gap-5 px-5 py-6 sm:px-6">
              <legend className="float-left mb-1 w-full p-0 text-base font-semibold leading-6 tracking-tight text-ink">
                {GROUP_LABEL[group].title}
              </legend>
              <p className="clear-both -mt-3 text-sm leading-5 text-muted">{GROUP_LABEL[group].description}</p>
              {FIELDS.filter((f) => f.group === group).map((meta) => (
                <NumberField
                  key={meta.key}
                  meta={meta}
                  value={raw[meta.key]}
                  error={errors[meta.key]}
                  onChange={(v) => set(meta.key, v)}
                />
              ))}
              {group === "carriers" && shareTotal !== null && (
                <p data-testid="roi-share-total" className="tabular text-sm text-muted">
                  {shareTotal === 100
                    ? "Total: 100%."
                    : shareTotal > 0
                      ? `Total entered: ${formatCount(shareTotal)}%, rescaled to 100%.`
                      : "Total: 0%. Give at least one carrier a share."}
                </p>
              )}
            </fieldset>
          ))}
          <div className="px-5 py-4 sm:px-6">
            <button
              type="button"
              onClick={() => setRaw(defaultRaw())}
              disabled={isDefault}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-strong bg-surface px-4 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
              Reset to the examples
            </button>
          </div>
        </form>

        <section
          aria-labelledby="roi-results-title"
          // Sticky from laptop width so the figures stay in view while a field is edited; on a short
          // screen the card scrolls inside itself instead of hiding its bottom.
          className="order-1 rounded-2xl border border-border bg-surface p-5 shadow-raised sm:p-6 lg:sticky lg:top-20 lg:order-2 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
        >
          <h2 id="roi-results-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Per year, with these numbers
          </h2>
          <div className="mt-4">
            {result ? (
              <Results result={result} measured={measured} />
            ) : (
              <div
                data-testid="roi-invalid"
                className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-danger"
              >
                <CircleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
                <div className="min-w-0 text-sm leading-relaxed">
                  <p className="font-medium">
                    {errorCount === 1 ? "One number is not valid" : `${errorCount} numbers are not valid`}: fix{" "}
                    {errorCount === 1 ? "it" : "them"} in the form to see the results.
                  </p>
                  <ul aria-label="Fields to fix" className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                    {invalidKeys.map((key) => (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => document.getElementById(fieldId(key))?.focus()}
                          className="rounded font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {FIELDS.find((f) => f.key === key)?.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      {result && (
        <section aria-labelledby="roi-carriers-title" className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <h2 id="roi-carriers-title" className="text-base font-semibold tracking-tight text-ink">
            Per carrier, per year
          </h2>
          <p className="mt-0.5 text-sm leading-5 text-muted">
            One claim is the maximum the carrier&apos;s rules allow for your item and parcel weight. Amounts and windows are
            ceilings from the public standard terms in data/carriers.json, computed by the same code that prepares a claim. A
            negotiated contract may differ, and the carrier decides what it pays.
          </p>
          <div className="mt-4">
            <CarrierTable result={result} />
          </div>
        </section>
      )}
    </div>
  );
}

