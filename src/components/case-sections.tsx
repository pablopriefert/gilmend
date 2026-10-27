import type { ReactNode } from "react";
import type {
  CarrierRules,
  CaseRecord,
  ClaimComputation,
  DamageAssessment,
  Decision,
  Evidence,
  Order,
  TraceStep,
  VoiceNote,
} from "@/lib/types";
import { evidenceForPhotos } from "@/lib/evidence/merge";
import { isStaleSource, noteVerification, prettyJson, type NoteFlag } from "./display-data";
import {
  DAMAGE_TYPE_LABEL,
  DECISION_LABEL,
  PHOTO_QUALITY_LABEL,
  SEVERITY_LABEL,
  deadlineInfo,
  formatDate,
  formatDateTime,
  formatEur,
} from "./format";
import { photoSrc } from "./photo-src";

export function Card({
  id,
  title,
  children,
  action,
}: {
  id: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

function Flag({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "ok" | "neutral" }) {
  const cls =
    tone === "warn"
      ? "bg-amber-100 text-amber-900"
      : tone === "ok"
        ? "bg-emerald-100 text-emerald-900"
        : "bg-slate-100 text-slate-800";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

function Photo({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  const url = photoSrc(src);
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${alt} (opens full size)`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- served by /api/files, image optimisation is switched off */}
          <img src={url} alt={alt} className="aspect-[4/3] w-full rounded-md border border-border bg-background object-cover" />
        </a>
      ) : (
        <div className="grid aspect-[4/3] w-full place-items-center rounded-md border border-dashed border-border bg-background text-xs text-muted">
          Photo unavailable
        </div>
      )}
      <figcaption className="text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}

/** Customer's message and the photos. Annotated evidence (SAM 3.1) sits beside the original. */
export function EvidenceSection({
  message,
  photos,
  evidence,
  voiceNote,
  inClaim = false,
}: {
  message: string;
  photos: string[];
  evidence: Evidence[];
  voiceNote?: VoiceNote;
  /** The case carries a carrier claim, so the outlined image really goes into its PDF. */
  inClaim?: boolean;
}) {
  // Every photo the customer sent, each with its annotated version when the agent made one.
  const items: Evidence[] = evidenceForPhotos(photos, evidence);
  return (
    <Card id="evidence-title" title="Customer report and evidence">
      {voiceNote && (
        <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          {voiceNote.demo ? (
            <Flag>Voice message: DEMO MODE, canned transcript</Flag>
          ) : (
            <Flag tone="ok">Voice message, transcribed by {voiceNote.model}</Flag>
          )}
          <span className="text-muted">
            {Math.max(1, Math.round(voiceNote.durationMs / 1000))} s
            {voiceNote.demo
              ? ": no speech model was called, the text below is not what was said."
              : voiceNote.edited
                ? ", edited by the customer after transcription."
                : voiceNote.partial
                  ? ", sent as transcribed, with typed text added."
                  : ", sent as transcribed."}
          </span>
        </p>
      )}
      <blockquote className="whitespace-pre-wrap rounded-md border-l-4 border-accent bg-background px-4 py-3 text-sm">
        {message}
      </blockquote>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No photo was attached to this report.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-5">
          {items.map((e, i) => (
            <li key={`${e.photo}-${i}`}>
              <div className={`grid gap-3 ${e.annotatedPhoto ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
                <Photo src={e.photo} alt={`Customer photo ${i + 1}`} caption={`Photo ${i + 1}, as sent by the customer`} />
                {e.annotatedPhoto && (
                  <Photo
                    src={e.annotatedPhoto}
                    alt={`Photo ${i + 1} outlined by SAM 3.1`}
                    caption={`Outlined by SAM 3.1: what it matched (the item, its pieces or the box)${inClaim ? ". This image goes in the claim" : ""}`}
                  />
                )}
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {e.method === "sam-3.1" ? (
                  <Flag tone="ok">Annotated with SAM 3.1</Flag>
                ) : (
                  <Flag tone="neutral">Raw photo: not annotated</Flag>
                )}
                {e.note && <span className="text-muted">{e.note}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function OrderSection({ order }: { order: Order | null }) {
  return (
    <Card id="order-title" title="Order">
      {!order ? (
        <p className="text-sm text-muted">
          <Flag>Not found</Flag> No order matches the number and e-mail the customer gave, so the agent could
          not check carrier, value or delivery date.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Fact label="Order">{order.id}</Fact>
            <Fact label="Customer">{order.name}</Fact>
            <Fact label="Total">{formatEur(order.total)}</Fact>
            <Fact label="Carrier">{order.service}</Fact>
            <Fact label="Tracking number">
              <span className="font-mono text-xs">{order.trackingNumber}</span>
            </Fact>
            <Fact label="Weight">{order.weightKg} kg</Fact>
            <Fact label="Delivered">{order.deliveredAt ? formatDate(order.deliveredAt) : "Not delivered yet"}</Fact>
            <Fact label="Ship to">
              {order.shippingAddress.city}, {order.shippingAddress.country}
            </Fact>
          </dl>
          <ul className="mt-4 divide-y divide-border rounded-md border border-border text-sm">
            {order.lineItems.map((li) => (
              <li key={li.sku} className="flex justify-between gap-3 px-3 py-2">
                <span>
                  {li.quantity} × {li.title}
                </span>
                <span className="text-muted">{formatEur(li.unitPrice * li.quantity)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export function AssessmentSection({ assessment }: { assessment: DamageAssessment | null }) {
  return (
    <Card id="assessment-title" title="What the agent saw">
      {!assessment ? (
        <p className="text-sm text-muted">The photos were not assessed.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Fact label="Item">{assessment.item}</Fact>
            <Fact label="Damage">{DAMAGE_TYPE_LABEL[assessment.damageType]}</Fact>
            <Fact label="Severity">{SEVERITY_LABEL[assessment.severity]}</Fact>
            <Fact label="Carrier likely at fault">{assessment.carrierLikelyAtFault ? "Yes" : "No"}</Fact>
            <Fact label="Packaging">
              {assessment.packagingAdequate === null
                ? "Cannot tell from the photos"
                : assessment.packagingAdequate
                  ? "Adequate"
                  : "Too weak for transport"}
            </Fact>
            <Fact label="Photo quality">{PHOTO_QUALITY_LABEL[assessment.photoQuality]}</Fact>
          </dl>
          {assessment.evidenceNotes.length > 0 && (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
              {assessment.evidenceNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * The shared contract (CarrierRules) plus, when the rules module provides them, the status of
 * every figure. The runtime object from getCarrierRules() carries `figures`; a rules object
 * without them (the bare contract) simply shows no figure table.
 */
export interface RuleFigureView {
  key: string;
  label: string;
  value: string;
  status: "verified" | "dated_source" | "unverified";
  checkedOn: string;
  note: string;
}
export type RulesView = CarrierRules & { figures?: RuleFigureView[] };

const FIGURE_FLAG: Record<RuleFigureView["status"], { label: string; tone: "ok" | "warn" }> = {
  verified: { label: "Verified", tone: "ok" },
  dated_source: { label: "Dated source", tone: "warn" },
  unverified: { label: "Unverified", tone: "warn" },
};

const NOTE_FLAG_LABEL: Record<Exclude<NoteFlag, null>, string> = {
  unverified: "Unverified",
  dated_source: "Dated source",
};

function describeCompensation(c: CarrierRules["compensation"]): string {
  const parts: string[] = [];
  if (c.flatEur !== undefined) parts.push(`${formatEur(c.flatEur)} per parcel`);
  if (c.perKgEur !== undefined) parts.push(`${formatEur(c.perKgEur)} per kg`);
  const base = parts.length > 0 ? parts.join(" or ") : "Per the carrier grid";
  return `${base}, capped at ${formatEur(c.capEur)}`;
}

function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * Claim computation. Amounts and deadlines come from dated carrier rules and deterministic
 * code, never from the model; the section says so and flags anything unverified.
 */
export function ClaimSection({
  claim,
  rules,
  now,
}: {
  claim: ClaimComputation | null;
  rules: RulesView | null;
  now: Date;
}) {
  const deadline = deadlineInfo(claim, now);
  return (
    <Card id="claim-title" title="Carrier claim">
      {!claim ? (
        <p className="text-sm text-muted">No claim was computed for this case.</p>
      ) : (
        <>
          <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            {claim.eligible ? <Flag tone="ok">Eligible</Flag> : <Flag tone="neutral">Not eligible</Flag>}
            <span className="text-muted">Computed by code from the carrier&apos;s rules, not by the model.</span>
          </p>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label="Max. compensation">
              <span className="text-lg font-semibold">{formatEur(claim.maxCompensationEur)}</span>
            </Fact>
            <Fact label="Claim deadline">
              {claim.claimDeadline ? (
                <>
                  {formatDate(claim.claimDeadline)}
                  <span className="block text-xs text-muted">{deadline.text}</span>
                </>
              ) : (
                "None"
              )}
            </Fact>
            <Fact label="Reserves due by">
              {claim.reserveDeadline ? formatDateTime(claim.reserveDeadline) : "Not applicable"}
            </Fact>
          </dl>
          {claim.reasons.length > 0 && (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
              {claim.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">Carrier rules used{rules ? `: ${rules.label}` : ""}</h3>
        {!rules ? (
          <p className="mt-2 text-sm text-muted">The carrier rules could not be loaded for this case.</p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Fact label="Compensation">{describeCompensation(rules.compensation)}</Fact>
              <Fact label="Reserves within">{rules.reserveDeadlineHours} h of delivery</Fact>
              <Fact label="Claim within">{rules.claimDeadlineDays} days</Fact>
            </dl>
            {rules.requiresRefusal && (
              <p className="mt-3 text-sm">
                <Flag>Refusal expected</Flag> The carrier expects the customer to refuse a damaged parcel.
              </p>
            )}
            {rules.notes.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-sm">
                {rules.notes.map((raw, i) => {
                  const note = noteVerification(raw);
                  return (
                    <li key={i} className="flex flex-wrap items-baseline gap-2">
                      {note.flag && <Flag>{NOTE_FLAG_LABEL[note.flag]}</Flag>}
                      <span>{note.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {rules.figures && rules.figures.length > 0 && (
              <>
                <h4 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">
                  Figures and how sure we are
                </h4>
                <ul className="mt-1 divide-y divide-border rounded-md border border-border text-sm">
                  {rules.figures.map((f) => (
                    <li key={f.key} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4">
                      <div className="min-w-0">
                        <span className="font-medium">{f.label}</span>
                        <span className="text-muted">: {f.value}</span>
                        {f.note && <p className="mt-0.5 text-xs text-muted">{f.note}</p>}
                      </div>
                      <div className="sm:text-right">
                        <Flag tone={FIGURE_FLAG[f.status].tone}>{FIGURE_FLAG[f.status].label}</Flag>
                        <span className="mt-0.5 block text-xs text-muted">checked {formatDate(f.checkedOn)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h4 className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Sources</h4>
            <ul className="mt-1 space-y-1 text-sm">
              {rules.sources.map((s) => {
                const href = safeHref(s.url);
                return (
                  <li key={s.url} className="flex flex-wrap items-baseline gap-x-2">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
                        {s.title}
                      </a>
                    ) : (
                      <span>{s.title}</span>
                    )}
                    <span className="text-xs text-muted">checked {formatDate(s.checkedOn)}</span>
                    {isStaleSource(s.checkedOn, now) && <Flag>Not re-checked recently</Flag>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}

/** The agent's decision: what it chose, how sure it is, why, and whether a human must look. */
export function DecisionSection({ decision }: { decision: Decision | null }) {
  if (!decision) {
    return (
      <Card id="decision-title" title="Decision">
        <p className="text-sm text-muted">The agent did not reach a decision for this case.</p>
      </Card>
    );
  }
  const pct = Math.round(Math.min(1, Math.max(0, decision.confidence)) * 100);
  return (
    <Card id="decision-title" title="Decision">
      {decision.needsHuman && (
        <p role="note" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <strong>Needs your judgement.</strong> The agent flagged this case: low confidence, high value or
          signs of fraud.
        </p>
      )}
      <p className="text-2xl font-semibold tracking-tight" data-testid="decision-kind">
        {DECISION_LABEL[decision.decision]}
      </p>
      <p className="mt-1 text-sm text-muted">
        Carrier claim: <strong className="font-semibold text-foreground">{decision.carrierClaim ? "yes" : "no"}</strong>
      </p>
      <div className="mt-3">
        <div className="flex justify-between text-xs text-muted">
          <span id="confidence-label">Confidence</span>
          <span>{pct}%</span>
        </div>
        <div
          role="meter"
          aria-labelledby="confidence-label"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-1 h-2 overflow-hidden rounded-full bg-border"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {decision.reasons.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
          {decision.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The claim PDF (embedded preview, download) and the e-mail that goes with it. */
export function DocumentSection({ caseId, document: doc }: { caseId: string; document: CaseRecord["document"] }) {
  if (!doc) {
    return (
      <Card id="document-title" title="Claim document">
        <p className="text-sm text-muted">No claim document: this case does not need a carrier claim.</p>
      </Card>
    );
  }
  const pdf = `/api/cases/${encodeURIComponent(caseId)}/pdf`;
  return (
    <Card
      id="document-title"
      title="Claim document"
      action={
        <a
          href={`${pdf}?download=1`}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-background"
        >
          Download PDF
        </a>
      }
    >
      <iframe title="Carrier claim PDF preview" src={pdf} className="h-[34rem] w-full rounded-md border border-border bg-background" />
      <h3 className="mt-5 text-sm font-semibold">E-mail to the carrier&apos;s claims department</h3>
      <p className="mt-1 text-xs text-muted">Ready to send. Damage Desk does not send it.</p>
      <p className="mt-3 text-sm">
        <span className="font-medium">Subject: </span>
        {doc.emailSubject}
      </p>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-sans text-sm">
        {doc.emailBody}
      </pre>
    </Card>
  );
}

function TraceItem({ step, index }: { step: TraceStep; index: number }) {
  const hasPayload = step.input !== undefined || step.output !== undefined;
  const heading = (
    <>
      <span className="w-6 shrink-0 text-xs tabular-nums text-muted">{index + 1}.</span>
      {step.tool && <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">{step.tool}</code>}
      <span className="min-w-0 flex-1 text-sm">{step.step}</span>
      <time dateTime={step.at} className="hidden shrink-0 text-xs text-muted sm:block">
        {formatDateTime(step.at)}
      </time>
    </>
  );
  if (!hasPayload) {
    return <li className="flex items-center gap-2 px-3 py-2">{heading}</li>;
  }
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-background">{heading}</summary>
        <div className="grid gap-3 border-t border-border bg-background px-3 py-3">
          {step.input !== undefined && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Input</div>
              <pre className="max-h-64 overflow-auto rounded border border-border bg-surface p-2 font-mono text-xs">{prettyJson(step.input)}</pre>
            </div>
          )}
          {step.output !== undefined && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Output</div>
              <pre className="max-h-64 overflow-auto rounded border border-border bg-surface p-2 font-mono text-xs">{prettyJson(step.output)}</pre>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

/** The agent's reasoning trace, tool by tool. Collapsed by default: it is for checking, not reading. */
export function TraceSection({ trace }: { trace: TraceStep[] }) {
  return (
    <section aria-labelledby="trace-title" className="rounded-lg border border-border bg-surface">
      <details>
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4">
          <h2 id="trace-title" className="text-base font-semibold">
            Agent reasoning trace
          </h2>
          <span className="text-sm text-muted">
            {trace.length} {trace.length === 1 ? "step" : "steps"}
          </span>
        </summary>
        {trace.length === 0 ? (
          <p className="border-t border-border px-5 py-4 text-sm text-muted">No steps were recorded.</p>
        ) : (
          <ol className="divide-y divide-border border-t border-border">
            {trace.map((step, i) => (
              <TraceItem key={`${step.at}-${i}`} step={step} index={i} />
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}
