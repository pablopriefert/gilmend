"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FlaskConical,
  Info,
  ListChecks,
  LoaderCircle,
  MessageSquareReply,
  Play,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { formatCountdown } from "@/lib/impact/insights";
import { formatMoment } from "@/lib/sweep/format";
import type { SweepAction, SweepItem, SweepResult, SweepText } from "@/lib/sweep/types";
import { cn } from "@/lib/utils";
import { AccessCodeField, accessHeaders, useAccessCode } from "../access-code";
import { CopyButton } from "../case/copy-button";
import { BUTTON_PRIMARY, BUTTON_QUIET, Eyebrow, Note, Pill, type Tone } from "../case/ui";
import { EngineBadge } from "../engine-badge";
import { formatDateTime, formatEur, languageName } from "../format";
import { RecordedBadge } from "../recorded-badge";

// The "Today" panel at the top of the Cases page (29 Oct 2026): what the morning sweep found, in
// the order the code ranked it. The briefing and the nudge drafts are the only words a model
// wrote, and each says who wrote it (Muse, the labelled DEMO MODE script, or a plain template).
// Every deadline, countdown and amount is the code's. Nothing here sends anything: a nudge is a
// draft to copy.

const HOUR_MS = 3_600_000;

const ACTIONS: Record<SweepAction, { label: string; icon: LucideIcon }> = {
  nudge_customer: { label: "Nudge the customer", icon: MessageSquareReply },
  file_claim: { label: "File the claim", icon: FileCheck2 },
  review_case: { label: "Review the case", icon: ClipboardCheck },
  check_failed_run: { label: "Check the failed run", icon: TriangleAlert },
};

/** The browser's clock, refreshed every minute, starting from the server's so the first render matches. */
function useNow(initialIso: string): number {
  const [now, setNow] = useState(() => Date.parse(initialIso));
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

interface RunResponse {
  sweep?: SweepResult;
  stored?: boolean;
  error?: string;
  message?: string;
}

/**
 * The morning sweep. `sweep` is the latest stored one (null before the first). The page passes
 * `now` (the server's clock) so the countdowns of the first render agree with the server's; they
 * then follow the browser's clock. `accessCodeRequired` says whether the server asks for the access
 * code to run a sweep (a public deployment).
 */
export function TodayPanel({
  sweep: initial,
  now: serverNow,
  accessCodeRequired,
  storageEphemeral = false,
}: {
  sweep: SweepResult | null;
  now: string;
  accessCodeRequired: boolean;
  /** A deployment on temporary per-instance storage: a stored sweep may not be seen by another instance. */
  storageEphemeral?: boolean;
}) {
  const baseId = useId();
  const codeId = `${baseId}-code`;
  const recordedId = `${baseId}-recorded`;
  const briefingId = `${baseId}-briefing`;
  const nowMs = useNow(serverNow);
  const [sweep, setSweep] = useState<SweepResult | null>(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notStored, setNotStored] = useState(false);
  const [includeRecorded, setIncludeRecorded] = useState(false);
  const [code, setCode] = useAccessCode();
  // Cases the merchant marked as filed since this sweep ran: they leave the plan at the next sweep.
  const [filed, setFiled] = useState<ReadonlySet<string>>(new Set());
  // What a screen reader hears once a run is over (the live region goes quiet after "Running").
  const [lastResult, setLastResult] = useState("");
  // Counts the successful runs: each one moves focus to the new paragraph, because the list under the
  // button was replaced (the effect runs after the render that shows it).
  const [runsDone, setRunsDone] = useState(0);
  useEffect(() => {
    if (runsDone > 0) document.getElementById(briefingId)?.focus();
  }, [runsDone, briefingId]);

  async function runNow(): Promise<void> {
    if (running) return;
    setError(null);
    if (accessCodeRequired && code.trim() === "") {
      setError("Enter the access code from the submission to run a sweep. This public demo runs none without it.");
      document.getElementById(codeId)?.focus();
      return;
    }
    setRunning(true);
    try {
      const res = await fetch("/api/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...accessHeaders(code) },
        body: JSON.stringify({ includeRecorded }),
      });
      const data = (await res.json().catch(() => null)) as RunResponse | null;
      if (!res.ok || !data?.sweep) {
        setError(data?.message ?? "The sweep could not run. Nothing was changed.");
        return;
      }
      setSweep(data.sweep);
      setNotStored(data.stored === false);
      setFiled(new Set());
      setLastResult(describeRun(data.sweep, data.stored !== false));
      setRunsDone((n) => n + 1);
    } catch {
      setError("Could not reach the server. Check your connection and try again. Nothing was changed.");
    } finally {
      setRunning(false);
    }
  }

  /** The merchant's own note that they filed the claim (true), or that they did not after all (false). */
  async function setClaimFiled(caseId: string, value: boolean): Promise<void> {
    const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...accessHeaders(code) },
      body: JSON.stringify({ claimFiled: value }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(data?.message ?? "The note could not be saved.");
    }
    setFiled((prev) => {
      const next = new Set(prev);
      if (value) next.add(caseId);
      else next.delete(caseId);
      return next;
    });
  }

  return (
    <section aria-labelledby="today-title" data-testid="today-panel" className="flex flex-col gap-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <Eyebrow>Today</Eyebrow>
          <h2 id="today-title" className="mt-2 font-display text-2xl leading-tight tracking-tight text-ink sm:text-3xl">
            What to do first this morning
          </h2>
        </div>
        <div className="flex flex-col gap-3 lg:items-end">
          {accessCodeRequired && (
            <AccessCodeField
              id={codeId}
              value={code}
              onChange={setCode}
              hint="Running a sweep can call the model, so this public demo asks for the code."
            />
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label htmlFor={recordedId} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-soft pointer-fine:min-h-9">
              <input
                id={recordedId}
                type="checkbox"
                checked={includeRecorded}
                onChange={(e) => setIncludeRecorded(e.target.checked)}
                className="h-4 w-4 accent-ink"
              />
              Also read the recorded runs (rehearsal)
            </label>
            <button type="button" className={BUTTON_PRIMARY} onClick={() => void runNow()} disabled={running} aria-busy={running}>
              {running ? (
                <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:hidden" strokeWidth={2} />
              ) : (
                <Play aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
              )}
              {running ? "Running the sweep…" : "Run the sweep now"}
            </button>
          </div>
        </div>
      </header>

      <p role="status" className="sr-only">
        {running ? "Running the sweep." : lastResult}
      </p>
      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger-soft px-5 py-4 text-danger">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
          <p className="text-sm font-medium leading-relaxed">{error}</p>
        </div>
      )}

      {sweep === null ? (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
          <ListChecks aria-hidden="true" className="mx-auto h-6 w-6 text-muted" strokeWidth={1.75} />
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
            No sweep has run yet. A sweep reads every open case and tells you what to do first, which claim deadline is
            closing and which customer to nudge. Run one now.
          </p>
          {storageEphemeral && (
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted">
              This deployment keeps data on one server instance: a sweep run by the daily schedule may not be seen from here.
            </p>
          )}
        </div>
      ) : (
        <SweepView
          sweep={sweep}
          nowMs={nowMs}
          filed={filed}
          onSetFiled={setClaimFiled}
          notStored={notStored}
          briefingId={briefingId}
        />
      )}
    </section>
  );
}

/** The sentence a screen reader hears when a run is over. */
function describeRun(sweep: SweepResult, stored: boolean): string {
  const { counts } = sweep;
  const by = sweep.engine === "demo-mock" ? ", texts written by the DEMO MODE script" : "";
  const kept = stored ? "" : " The result was not saved.";
  if (sweep.items.length === 0) return `Sweep done: nothing is due${by}.${kept}`;
  return `Sweep done: ${counts.due} ${counts.due === 1 ? "case needs" : "cases need"} you, ${counts.closingSoon} close within ${sweep.horizonHours} h${by}.${kept}`;
}

/**
 * What the browser's clock says about a stored sweep. A sweep is up to a day old (the cron runs once a
 * day), so deadlines that were ahead when it ran may have passed since: the amount of such an item is
 * not claimable any more, and the totals must not count it. A recorded run is read as of its recording
 * and never ticks against today's clock.
 */
function liveOf(item: SweepItem, nowMs: number, horizonHours: number) {
  const recorded = item.recordedOn !== null;
  const d = item.deadline;
  const hoursLeft = d ? (recorded ? d.hoursLeft : (Date.parse(d.at) - nowMs) / HOUR_MS) : null;
  const passed = hoursLeft !== null && hoursLeft < 0;
  const soon = hoursLeft !== null && !passed && (recorded ? item.withinHorizon : hoursLeft <= horizonHours);
  const claimEnds = item.claimDeadlineAt ? Date.parse(item.claimDeadlineAt) : null;
  const amountExpired = !recorded && item.amountEur > 0 && claimEnds !== null && claimEnds <= nowMs;
  return { hoursLeft, passed, soon, amountExpired };
}

function SweepView({
  sweep,
  nowMs,
  filed,
  onSetFiled,
  notStored,
  briefingId,
}: {
  sweep: SweepResult;
  nowMs: number;
  filed: ReadonlySet<string>;
  onSetFiled: (caseId: string, value: boolean) => Promise<void>;
  notStored: boolean;
  briefingId: string;
}) {
  const { counts } = sweep;
  // The totals as of now: the stored ones, minus what the listed items lost since the sweep ran, plus
  // the listed items that came inside the horizon since. Items past the cap of the list cannot be
  // recomputed and keep their stored figures (said below the paragraph when there are any).
  const live = sweep.items.map((item) => ({ item, ...liveOf(item, nowMs, sweep.horizonHours) }));
  const lostCents = live
    .filter((l) => l.amountExpired && !l.item.simulatedReply)
    .reduce((sum, l) => sum + Math.round(l.item.amountEur * 100), 0);
  const moneyEur = Math.max(0, Math.round(sweep.moneyAtStakeEur * 100) - lostCents) / 100;
  const closingSoon = Math.max(
    0,
    counts.closingSoon - live.filter((l) => l.item.withinHorizon).length + live.filter((l) => l.soon).length,
  );
  const deadlinesPassed = live.filter((l) => l.passed || l.amountExpired).length;
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
          <EngineBadge engine={sweep.engine} detail={sweep.engineDetail} />
          <span className="tabular" data-testid="today-last-run">
            Last sweep {formatDateTime(sweep.generatedAt)} ({sweep.trigger === "cron" ? "scheduled run" : "run on demand"})
          </span>
        </div>
        <Briefing text={sweep.briefing} id={briefingId} />
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4" data-testid="today-counts">
          <Count label="Need you" value={counts.due} />
          <Count label={`Closing in ${sweep.horizonHours} h`} value={closingSoon} />
          <Count label="Customers not answering" value={counts.waitingOnCustomer} />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Could still be claimed</dt>
            <dd className="tabular mt-1 font-display text-2xl text-gold-ink">{formatEur(moneyEur, { whole: false })}</dd>
            <dd className="mt-0.5 text-xs text-muted">At most, never a promise.</dd>
          </div>
        </dl>
      </div>

      {deadlinesPassed > 0 && (
        <Note tone="warn" icon={TriangleAlert} data-testid="today-stale">
          <strong>
            {deadlinesPassed} {deadlinesPassed === 1 ? "deadline has" : "deadlines have"} passed since this sweep ran.
          </strong>{" "}
          The amounts and the counts above leave {deadlinesPassed === 1 ? "it" : "them"} out, but the paragraph was written
          before. Run the sweep again to refresh it.
          {sweep.moreItems > 0 ? " Cases beyond the list are not recomputed here." : ""}
        </Note>
      )}
      {sweep.includeRecorded && (
        <Note tone="info" icon={Info}>
          <strong>Rehearsal.</strong> This sweep also read the recorded runs, each as of its own recording day, so their
          deadlines count from then, not from today.
        </Note>
      )}
      {sweep.engine === "demo-mock" && (
        <Note tone="warn" icon={FlaskConical}>
          <strong>DEMO MODE.</strong>{" "}
          {sweep.fellBackReason === "daily_limit"
            ? "The daily limit of real runs was reached, so the texts below come from a script, not from Muse."
            : "No model key is set here, so the texts below come from a script, not from Muse."}{" "}
          The ranking, the deadlines and the amounts are computed by code and are the same either way.
        </Note>
      )}
      {notStored && (
        <Note tone="warn" icon={TriangleAlert}>
          This sweep ran but could not be stored, so other visitors will not see it. Check the server log.
        </Note>
      )}

      {sweep.items.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface px-5 py-6 text-sm text-muted shadow-card" data-testid="today-empty">
          Nothing is due. No deadline closes in the next {sweep.horizonHours} h, and no case waits for you or for a customer.
        </p>
      ) : (
        <ol aria-label="Today's plan" className="flex flex-col gap-3">
          {live.map(({ item, hoursLeft, passed, soon, amountExpired }) => (
            <PlanItem
              key={item.caseId}
              item={item}
              hoursLeft={hoursLeft}
              passed={passed}
              soon={soon}
              amountExpired={amountExpired}
              filed={filed.has(item.caseId)}
              onSetFiled={onSetFiled}
            />
          ))}
        </ol>
      )}
      {sweep.moreItems > 0 && (
        <p className="text-sm text-muted">
          {sweep.moreItems} more {sweep.moreItems === 1 ? "case is" : "cases are"} due: they are in the list below.
        </p>
      )}

      <p className="flex items-start gap-2 text-xs leading-5 text-muted">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span>
          The order, the deadlines and the amounts are worked out by code from the carrier rules. A model only writes the
          paragraph above and the nudge drafts: it never writes a figure (the code fills in every order number, date and
          amount), and a text that states one, promises money or names a deadline is refused. Drafts are checked in
          English and French only; another language gets a template. Nothing is sent to anyone: a draft is for you to copy.
          {sweep.modelCalls.total > 0
            ? ` This sweep made ${sweep.modelCalls.total} model ${sweep.modelCalls.total === 1 ? "call" : "calls"} (limit ${sweep.modelCalls.cap}).`
            : sweep.reusedTexts > 0
              ? " This sweep made no model call: today's texts were reused."
              : ""}
        </span>
      </p>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="tabular mt-1 font-display text-2xl text-ink">{value}</dd>
    </div>
  );
}

/** The paragraph, and who wrote it. */
function Briefing({ text, id }: { text: SweepText; id: string }) {
  return (
    <div className="mt-4">
      <p id={id} tabIndex={-1} data-testid="today-briefing" className="max-w-3xl rounded-sm text-base leading-relaxed text-ink">
        {text.text}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted" data-testid="today-briefing-source">
        {sourceLabel(text, "paragraph")}
      </p>
    </div>
  );
}

function sourceLabel(text: SweepText, what: string): string {
  switch (text.source) {
    case "model":
      return `This ${what} was written by ${text.model ?? "the model"}.`;
    case "demo-mock":
      return `DEMO MODE: this ${what} comes from a script, not from Muse.`;
    case "template":
      return `Template text, not the model's${text.note ? `: ${text.note}` : ""}.`;
  }
}

function Countdown({
  item,
  hoursLeft,
  passed,
  soon,
}: {
  item: SweepItem;
  hoursLeft: number | null;
  passed: boolean;
  soon: boolean;
}) {
  const d = item.deadline;
  if (!d || hoursLeft === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted">
        <CalendarClock aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        No deadline ahead
      </span>
    );
  }
  const recorded = item.recordedOn !== null;
  const Icon = passed ? TriangleAlert : soon ? Clock3 : CalendarClock;
  const what = d.kind === "claim" ? "Claim deadline" : "Reserve window";
  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <span
        className={cn(
          "tabular inline-flex items-center gap-1.5 text-sm",
          passed
            ? "rounded-full bg-danger-soft px-2.5 py-1 font-semibold text-danger ring-1 ring-danger/25"
            : soon
              ? "rounded-full bg-warning-soft px-2.5 py-1 font-semibold text-warning ring-1 ring-warning/25"
              : "text-ink-soft",
        )}
      >
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
        {what} {passed ? "passed" : formatCountdown(hoursLeft)}
        {recorded && !passed ? " after the recording" : ""}
      </span>
      <span className="tabular text-xs text-muted">{formatMoment(d.at)}</span>
    </div>
  );
}

function PlanItem({
  item,
  hoursLeft,
  passed,
  soon,
  amountExpired,
  filed,
  onSetFiled,
}: {
  item: SweepItem;
  hoursLeft: number | null;
  passed: boolean;
  soon: boolean;
  /** The claim deadline passed since the sweep ran: the amount is not claimable any more. */
  amountExpired: boolean;
  filed: boolean;
  onSetFiled: (caseId: string, value: boolean) => Promise<void>;
}) {
  const action = ACTIONS[item.action];
  const ActionIcon = action.icon;
  const tone: Tone = item.action === "check_failed_run" ? "danger" : soon ? "warn" : "neutral";
  return (
    <li
      data-testid="today-item"
      data-case-id={item.caseId}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <span
            aria-hidden="true"
            className="tabular grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-surface-muted text-sm font-semibold text-ink"
          >
            {item.rank}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={tone} icon={ActionIcon}>
                {action.label}
              </Pill>
              {item.recordedOn && <RecordedBadge recorded={{ recordedOn: item.recordedOn }} compact />}
              {item.caseEngine === "demo-mock" && (
                <Pill tone="warn" icon={FlaskConical}>
                  DEMO MODE case
                </Pill>
              )}
            </div>
            <h3 className="mt-2 break-words text-base font-semibold leading-snug tracking-tight text-ink">
              <Link
                href={`/cases/${item.caseId}`}
                className="rounded-sm underline-offset-4 hover:underline focus-visible:underline"
                aria-label={`Open case ${item.orderId}, ${item.itemTitle}`}
              >
                {item.orderId} · {item.itemTitle}
              </Link>
            </h3>
            <p className="mt-0.5 text-sm text-muted">{item.carrierLabel ?? "Carrier unknown"}</p>
            <ul className="mt-3 flex flex-col gap-1 text-sm leading-relaxed text-ink-soft">
              {item.reasons.map((r) => (
                <li key={r.kind} data-reason={r.kind}>
                  {r.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end sm:text-right">
          <Countdown item={item} hoursLeft={hoursLeft} passed={passed} soon={soon} />
          {item.amountEur > 0 &&
            (amountExpired ? (
              // Gold is money that can still be claimed: a lost amount is struck through and plain.
              <p className="tabular text-sm text-muted" data-testid="today-amount-expired">
                <s>up to {formatEur(item.amountEur, { whole: false })}</s>
                <span className="ml-2 font-semibold text-ink-soft">deadline passed, no longer claimable</span>
              </p>
            ) : (
              <p className="tabular font-display text-xl text-gold-ink" data-testid="today-amount">
                up to {formatEur(item.amountEur, { whole: false })}
              </p>
            ))}
          {item.simulatedReply && item.amountEur > 0 && !amountExpired && <Pill icon={FlaskConical}>Simulated reply: not counted</Pill>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/cases/${item.caseId}`} className={item.action === "nudge_customer" ? BUTTON_QUIET : BUTTON_PRIMARY}>
          Open the case
        </Link>
        {item.action === "file_claim" && <MarkFiled caseId={item.caseId} filed={filed} onSetFiled={onSetFiled} />}
      </div>

      {item.nudge && <Nudge item={item} nudge={item.nudge} />}
    </li>
  );
}

function MarkFiled({
  caseId,
  filed,
  onSetFiled,
}: {
  caseId: string;
  filed: boolean;
  onSetFiled: (caseId: string, value: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function change(value: boolean) {
    setBusy(true);
    setError(null);
    onSetFiled(caseId, value)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "The note could not be saved."))
      .finally(() => setBusy(false));
  }
  const alert = error && (
    <span role="alert" className="text-sm text-danger">
      {error}
    </span>
  );
  if (filed) {
    return (
      <>
        <Pill tone="ok" icon={Check}>
          Marked as filed: it leaves the plan at the next sweep
        </Pill>
        <button type="button" className={BUTTON_QUIET} disabled={busy} onClick={() => change(false)}>
          {busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:hidden" strokeWidth={2} /> : <Undo2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />}
          Undo
        </button>
        {alert}
      </>
    );
  }
  return (
    <>
      <button type="button" className={BUTTON_QUIET} disabled={busy} onClick={() => change(true)}>
        {busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:hidden" strokeWidth={2} /> : <Check aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />}
        I filed it: mark as filed
      </button>
      {alert}
    </>
  );
}

function Nudge({ item, nudge }: { item: SweepItem; nudge: SweepText }) {
  return (
    <details className="group rounded-xl border border-border bg-surface-muted/70" data-testid="today-nudge">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span>Draft nudge for the customer ({languageName(item.language)})</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 text-muted transition-transform duration-200 group-open:rotate-180" strokeWidth={1.75} />
      </summary>
      <div className="flex flex-col gap-3 border-t border-border px-3.5 py-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft" data-testid="today-nudge-text">
          {nudge.text}
        </p>
        <p className="text-xs leading-5 text-muted">{sourceLabel(nudge, "draft")} Nothing is sent: copy it into your own mailbox.</p>
        <div>
          <CopyButton text={nudge.text} label="Copy the draft" toastTitle="Draft copied" />
        </div>
      </div>
    </details>
  );
}
