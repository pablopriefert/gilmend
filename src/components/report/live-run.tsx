"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Calculator,
  Check,
  CircleX,
  ClipboardCheck,
  FileText,
  FlaskConical,
  Inbox,
  LoaderCircle,
  Package,
  PackageSearch,
  Radio,
  ScanEye,
  Scale,
  Shapes,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BUTTON_PRIMARY, BUTTON_QUIET, Eyebrow, Pill } from "../case/ui";
import { EngineBadge } from "../engine-badge";
import { CARRIER_LABEL, DECISION_LABEL, formatDate, formatEur } from "../format";
import { photoSrc } from "../photo-src";
import AnimatedCounter from "../arc/animated-counter/animated-counter";
import { BorderBeam } from "../ui/border-beam";
import type { Engine } from "@/lib/types";
import { formatDuration, formatOffset, type LiveRunState, type LiveStep } from "./live-run-state";

// The live timeline (27 Oct 2026): what the agent is REALLY doing, drawn from the events the
// server streams as the run happens (see live-run-state.ts). It replaces the illustration of
// agent-working.tsx whenever the answer is streamed. In DEMO MODE the steps are real too (the
// order lookup, the claim maths and the PDF are code), but the model is a script, and the panel
// says so and does not show timings, which would only be milliseconds of a mock.

const STEP_ICON: Record<string, LucideIcon> = {
  get_order: PackageSearch,
  assess_photos: ScanEye,
  mark_damage: Shapes,
  get_carrier_rules: Scale,
  compute_claim: Calculator,
  finish_case: ClipboardCheck,
  draft_claim_document: FileText,
  intake: Inbox,
  thinking: Sparkles,
  guardrail: ShieldAlert,
  notice: TriangleAlert,
  other: Package,
};

/** Key of the icon of a step in STEP_ICON (a lookup, so the icon is never a component made during render). */
function iconKey(step: LiveStep): string {
  if (step.kind !== "tool") return step.kind;
  return step.tool && step.tool in STEP_ICON ? step.tool : "other";
}

/** Seconds before the finished case opens by itself. */
const AUTO_OPEN_SECONDS = 5;

export function LiveRun({
  state,
  expectedEngine,
  onOpen,
  autoOpenSeconds = AUTO_OPEN_SECONDS,
}: {
  state: LiveRunState;
  /** What the form said the report would run as: shown until the server confirms (`accepted`). */
  expectedEngine?: Engine;
  /** Open the saved case (the form navigates). */
  onOpen: (caseId: string) => void;
  autoOpenSeconds?: number;
}) {
  const engine = state.engine ?? expectedEngine ?? null;
  const mock = state.engine ? state.mock : engine === "demo-mock";
  const running = state.phase === "sending" || state.phase === "running";
  const clock = useElapsed(running);
  const done = state.phase === "done";

  // The last finished step, spoken once by a polite live region (the list itself is not live: it
  // would read every row again each time one changes).
  const finished = [...state.steps].reverse().find((s) => s.state !== "running" && (s.detail || s.kind === "intake"));
  const announcement = done
    ? `The case is ready, ${formatDuration(state.lastMs)} after the report was received.`
    : finished
      ? `${finished.label}${finished.detail ? `: ${finished.detail}` : ""}`
      : "";

  return (
    <div data-testid="live-run" className="animate-rise">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-8 sm:px-8">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {engine && <EngineBadge engine={engine} />}
            {mock ? (
              <Pill tone="warn" icon={FlaskConical} data-testid="live-run-mode">
                DEMO MODE (scripted)
              </Pill>
            ) : (
              <Pill tone="info" icon={Radio} data-testid="live-run-mode">
                Live
              </Pill>
            )}
            <span className="tabular text-xs text-muted" aria-hidden="true">
              {running ? clock : formatDuration(state.lastMs)}
            </span>
          </div>
          <h2 className="font-display text-3xl leading-tight tracking-tight text-foreground">
            {done ? "The case is ready" : "The agent is on your report"}
          </h2>
          <p className="max-w-prose text-sm leading-6 text-muted">
            {mock
              ? "DEMO MODE: the model is a script, no image is analysed and nothing below comes from Muse. The order lookup, the claim maths and the PDF are real code, and each step shows up as it runs."
              : state.label
                ? `${state.label}. Each step appears as it really happens, with the time on the server's clock. Nothing is sent to the customer or the carrier.`
                : "Each step appears as it really happens, with the time on the server's clock. Nothing is sent to the customer or the carrier."}
          </p>
        </div>

        <p role="status" className="sr-only">
          {announcement}
        </p>

        <div className="grid items-start gap-6 md:max-lg:grid-cols-[minmax(0,1fr)_16rem] xl:grid-cols-[minmax(0,1fr)_17.5rem]">
          <ol aria-label="What the agent is doing, live" className="relative flex min-w-0 flex-col gap-0.5">
            <span aria-hidden="true" className="absolute bottom-5 left-[1.0625rem] top-5 w-px bg-border" />
            {state.steps.map((step) => (
              <StepRow key={step.id} step={step} mock={mock} />
            ))}
          </ol>

          <aside aria-label="What the agent found" className="flex min-w-0 flex-col gap-4">
            <EvidencePanel state={state} mock={mock} />
          </aside>
        </div>

        {state.phase === "lost" && (
          <p role="alert" className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm text-warning">
            The connection dropped before the agent finished. The run keeps going on the server and the case is saved
            when it ends.
          </p>
        )}

        {done && state.caseId && <Completion caseId={state.caseId} onOpen={onOpen} seconds={autoOpenSeconds} />}
      </div>
    </div>
  );
}

// ---- timeline --------------------------------------------------------------------------

function StepRow({ step, mock }: { step: LiveStep; mock: boolean }) {
  const Icon = STEP_ICON[iconKey(step)];
  const current = step.state === "running";
  const failed = step.state === "failed";
  const compact = step.kind === "thinking";
  return (
    <li
      data-step={step.kind === "tool" ? step.tool : step.kind}
      aria-current={current ? "step" : undefined}
      className="animate-rise relative flex items-start gap-3 py-2"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative z-10 mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
          "h-[2.125rem] w-[2.125rem]",
          step.warning && "border-warning/40 bg-warning-soft text-warning",
          !step.warning && failed && "border-danger/40 bg-danger-soft text-danger",
          !step.warning && !failed && step.state === "done" && "border-ink bg-ink text-white",
          !step.warning && current && "border-ink bg-surface text-ink shadow-card",
        )}
      >
        {step.warning ? (
          <Icon className="h-4 w-4" strokeWidth={1.9} />
        ) : failed ? (
          <CircleX className="h-4 w-4" strokeWidth={2} />
        ) : current ? (
          <>
            <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:hidden" strokeWidth={2} />
            <Icon className="hidden h-4 w-4 motion-reduce:block" strokeWidth={1.75} />
          </>
        ) : step.kind === "thinking" || step.kind === "intake" ? (
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <Check className="h-4 w-4" strokeWidth={2.25} />
        )}
      </span>
      <span className="min-w-0 flex-1 pt-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span
            className={cn(
              "text-sm leading-5 text-foreground",
              current ? "font-semibold" : "font-medium",
              compact && !current && "font-normal text-muted",
            )}
          >
            {step.label}
            {step.calledBy === "code" && <span className="font-normal text-muted"> (run by the code, not the model)</span>}
            <span className="sr-only">{current ? " (in progress)" : failed ? " (failed)" : " (done)"}</span>
          </span>
          {step.kind !== "intake" && (
            <span className="tabular shrink-0 text-xs text-muted">
              {mock ? (
                "scripted"
              ) : (
                <>
                  {formatOffset(step.atMs)}
                  {step.ms !== undefined && step.ms >= 100 && <span> · {formatDuration(step.ms)}</span>}
                </>
              )}
            </span>
          )}
        </span>
        {step.detail && (
          <span
            className={cn(
              "mt-0.5 block text-xs leading-5",
              step.warning ? "text-warning" : failed ? "text-danger" : "text-muted",
            )}
          >
            {step.detail}
          </span>
        )}
      </span>
    </li>
  );
}

// ---- what was found --------------------------------------------------------------------

function EvidencePanel({ state, mock }: { state: LiveRunState; mock: boolean }) {
  const { order, orderMissing, outline, claim, decision } = state;
  const nothing = !order && !orderMissing && !outline && !claim && !decision;
  if (nothing) {
    return (
      <p className="rounded-xl border border-dashed border-border-strong bg-surface-muted px-4 py-3 text-xs leading-5 text-muted">
        The order, the outlined photo and the amount appear here as soon as the agent has them.
      </p>
    );
  }
  return (
    <>
      {order && (
        <section aria-label="Order found" className="animate-rise rounded-xl border border-border bg-surface-muted p-4">
          <Eyebrow>Order</Eyebrow>
          <p className="mt-1 flex items-center gap-2 font-display text-xl leading-none text-ink">
            <PackageSearch aria-hidden="true" className="h-4 w-4 text-ink-soft" strokeWidth={1.75} />
            {order.orderId}
          </p>
          <p className="mt-2 text-sm leading-5 text-ink-soft">
            {CARRIER_LABEL[order.carrier] ?? order.carrier}
            {order.service ? `, ${order.service}` : ""}
          </p>
          {order.items.length > 0 && <p className="mt-1 text-sm leading-5 text-ink-soft">{order.items.join(", ")}</p>}
          <p className="tabular mt-2 text-xs text-muted">
            {order.deliveredAt ? `Delivered ${formatDate(order.deliveredAt)}` : "Not delivered yet"}
            {" · "}
            {order.currency === "EUR" ? formatEur(order.total) : `${order.total.toFixed(2)} ${order.currency}`}
          </p>
        </section>
      )}
      {orderMissing && (
        <section aria-label="Order not found" className="animate-rise rounded-xl border border-warning/25 bg-warning-soft p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-warning">
            <TriangleAlert aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
            No order found
          </p>
          <p className="mt-1 text-xs leading-5 text-warning">
            No order matches this number and e-mail. The case will go to a human.
          </p>
        </section>
      )}
      {outline && <OutlineFigure outline={outline} mock={mock} />}
      {claim && <ClaimCard claim={claim} />}
      {decision && (
        <section aria-label="Decision" className="animate-rise rounded-xl border border-border bg-surface p-4">
          <Eyebrow>Decision</Eyebrow>
          <p className="mt-1 font-display text-xl leading-tight text-ink">{DECISION_LABEL[decision.decision]}</p>
          <p className="tabular mt-1 text-xs text-muted">Confidence {Math.round(decision.confidence * 100)}%</p>
          {decision.needsHuman && (
            <Pill tone="warn" icon={TriangleAlert} className="mt-2">
              Needs a human
            </Pill>
          )}
        </section>
      )}
    </>
  );
}

function OutlineFigure({ outline, mock }: { outline: NonNullable<LiveRunState["outline"]>; mock: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A cached image can be complete before React attaches onLoad.
    if (img.current?.complete && img.current.naturalWidth > 0) setLoaded(true);
  }, []);
  const src = photoSrc(outline.path);
  return (
    <figure className="animate-rise m-0 rounded-xl border border-border bg-surface p-2.5">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored evidence file served by /api/files, not a static asset
        <img
          ref={img}
          src={src}
          alt={`Photo ${outline.photoIndex + 1} outlined by SAM 3.1`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "aspect-[4/3] w-full rounded-lg bg-surface-muted object-contain transition-opacity duration-700 ease-out motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        <p className="grid aspect-[4/3] place-items-center rounded-lg bg-surface-muted p-3 text-center text-xs text-muted">
          The outlined photo is saved with the case; it could not be shown here.
        </p>
      )}
      <figcaption className="mt-2 px-1 text-xs leading-5 text-muted">
        <span className="font-semibold text-ink-soft">SAM 3.1 outline</span>
        {mock ? "" : `, ${outline.regions === 1 ? "1 region" : `${outline.regions} regions`}`}. What SAM matched (the item, its
        pieces or the box), not the damage itself.
      </figcaption>
    </figure>
  );
}

const GOLD_FIGURE = { "--text-3xl": "2.75rem", "--foreground": "var(--gold-ink)" } as CSSProperties;

/** Rolls up from zero to the amount: the number is final, only its arrival is animated. */
function CountUp({ value, decimals }: { value: number; decimals: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <AnimatedCounter value={shown} prefix="€" decimals={decimals} />;
}

function ClaimCard({ claim }: { claim: NonNullable<LiveRunState["claim"]> }) {
  const recoverable = claim.eligible && claim.maxCompensationEur > 0;
  return (
    <section aria-label="Claim" className="animate-rise">
      <BorderBeam color="var(--gold)" length={14} thickness={1.5} speed={7} className="rounded-2xl">
        <div className="rounded-2xl border border-gold/30 bg-gold-soft px-4 py-3.5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-ink">Maximum compensation</p>
          {recoverable ? (
            <div className="mt-2" style={GOLD_FIGURE}>
              <CountUp value={claim.maxCompensationEur} decimals={Number.isInteger(claim.maxCompensationEur) ? 0 : 2} />
            </div>
          ) : (
            <p className="mt-2 font-display text-2xl leading-none text-ink-soft">Not recoverable</p>
          )}
          {recoverable && claim.claimDeadline && (
            <p className="tabular mt-3 text-xs text-ink-soft">
              Claim by <span className="font-medium text-ink">{formatDate(claim.claimDeadline)}</span>
              {claim.daysLeft !== null && ` · ${claim.daysLeft === 1 ? "1 day" : `${Math.max(0, claim.daysLeft)} days`} left`}
            </p>
          )}
          <p className="mt-2 text-xs leading-5 text-muted">Worked out by code from the carrier&apos;s rules. Not a promise of payment.</p>
        </div>
      </BorderBeam>
    </section>
  );
}

// ---- the end ---------------------------------------------------------------------------

function Completion({ caseId, onOpen, seconds }: { caseId: string; onOpen: (id: string) => void; seconds: number }) {
  const [left, setLeft] = useState(seconds);
  const [stay, setStay] = useState(false);
  const open = useRef(onOpen);
  useEffect(() => {
    open.current = onOpen;
  });

  useEffect(() => {
    if (stay || seconds <= 0) return;
    if (left <= 0) {
      open.current(caseId);
      return;
    }
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, stay, seconds, caseId]);

  return (
    <div className="animate-rise flex flex-col gap-3 rounded-xl border border-border bg-surface-muted p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-ink-soft">
        {stay || seconds <= 0 ? (
          "Review the case when you are ready."
        ) : (
          <>
            Opening the case in <span className="tabular font-semibold text-ink">{left} s</span>.
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {!stay && seconds > 0 && (
          <button type="button" onClick={() => setStay(true)} className={BUTTON_QUIET}>
            Stay on this page
          </button>
        )}
        <button type="button" autoFocus onClick={() => onOpen(caseId)} className={BUTTON_PRIMARY}>
          Open the case
        </button>
      </div>
    </div>
  );
}

// ---- clock -----------------------------------------------------------------------------

/** "12.3 s" since this panel appeared, ticking while the run goes on. Decorative: the steps carry the real times. */
function useElapsed(active: boolean): string {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [active]);
  return formatDuration(now - started);
}
