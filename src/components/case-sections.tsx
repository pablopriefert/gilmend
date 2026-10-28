import {
  Calculator,
  Camera,
  CalendarClock,
  Check,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Download,
  ExternalLink,
  FlaskConical,
  FileCheck2,
  FileText,
  FileX2,
  History,
  ImageOff,
  Maximize2,
  Mail,
  Mic,
  Package,
  PackageX,
  Repeat2,
  Route,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRoundCheck,
  ChevronDown,
  ScanEye,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";
import { AnimatedCounter } from "@/components/arc/animated-counter/animated-counter";
import { BorderBeam } from "@/components/ui/border-beam";
import type {
  CarrierRules,
  CaseRecord,
  ClaimComputation,
  DamageAssessment,
  Decision,
  DecisionKind,
  Engine,
  Evidence,
  FollowUp,
  Order,
  PhotoIntegrity,
  TraceStep,
  VoiceNote,
} from "@/lib/types";
import { evidenceForPhotos } from "@/lib/evidence/merge";
import { groupTraceByRound } from "@/lib/rounds";
import { cn } from "@/lib/utils";
import { CopyButton } from "./case/copy-button";
import { IntegrityRow, type IntegrityMissing } from "./case/integrity-row";
import { TraceTimeline } from "./case/trace-timeline";
import { BUTTON_QUIET, Eyebrow, Fact, IconTile, Panel, Pill, riseStyle, type Tone } from "./case/ui";
import { isStaleSource, noteVerification, type NoteFlag } from "./display-data";
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

// The sections of the case page. Left column: the evidence and the numbers. Right column: the
// decision. Every honesty label of the first version is still here (what is a recording, what is
// a mock, what the code computed and what the model said), only restyled.

function Photo({
  src,
  alt,
  label,
  caption,
  note,
}: {
  src: string;
  alt: string;
  /** Short chip over the image: what this picture is. */
  label: string;
  caption: string;
  /** A second, quieter line under the caption. */
  note?: string;
}) {
  const url = photoSrc(src);
  return (
    <figure className="flex min-w-0 flex-col gap-2.5">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${alt} (opens full size)`}
          className="group relative block overflow-hidden rounded-xl border border-border bg-surface-muted shadow-card"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- served by /api/files, image optimisation is switched off */}
          <img
            src={url}
            alt={alt}
            className="aspect-[4/3] w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
          <span
            aria-hidden="true"
            className="absolute left-2.5 top-2.5 rounded-full bg-ink/90 px-2.5 py-1 text-[0.6875rem] font-semibold tracking-wide text-white"
          >
            {label}
          </span>
          <span
            aria-hidden="true"
            className="absolute bottom-2.5 right-2.5 grid h-8 w-8 place-items-center rounded-full bg-surface/95 text-ink opacity-0 shadow-card transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 hover-none:opacity-100"
          >
            <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
          </span>
        </a>
      ) : (
        <div className="grid aspect-[4/3] w-full place-items-center gap-1 rounded-xl border border-dashed border-border-strong bg-surface-muted text-xs text-muted">
          <span className="flex flex-col items-center gap-1.5">
            <ImageOff aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
            Photo unavailable
          </span>
        </div>
      )}
      <figcaption className="text-xs leading-relaxed text-muted">
        {caption}
        {note && <span className="mt-0.5 block">{note}</span>}
      </figcaption>
    </figure>
  );
}

/** The photos of one round, each as sent and, when the agent made one, its SAM 3.1 outline. */
function PhotoItems({
  items,
  firstNumber,
  inClaim,
}: {
  items: Evidence[];
  /** Number of the first photo of this list in the whole case (photos are numbered across rounds). */
  firstNumber: number;
  inClaim: boolean;
}) {
  return (
    <ul className="mt-4 flex flex-col gap-8">
      {items.map((e, i) => {
        const n = firstNumber + i;
        return (
          <li key={`${e.photo}-${n}`}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Photo
                src={e.photo}
                alt={`Customer photo ${n}`}
                label="As sent"
                caption={`Photo ${n}, as sent by the customer`}
              />
              {e.annotatedPhoto ? (
                <Photo
                  src={e.annotatedPhoto}
                  alt={`Photo ${n} outlined by SAM 3.1`}
                  label="SAM 3.1 outline"
                  caption={`Outlined by SAM 3.1: what it matched (the item, its pieces or the box)${inClaim ? ". This image goes in the claim" : ""}`}
                />
              ) : (
                <div className="hidden min-h-32 place-items-center rounded-xl border border-dashed border-border-strong bg-surface-muted p-4 text-center text-xs text-muted sm:grid">
                  <span className="flex flex-col items-center gap-1.5">
                    <ScanSearch aria-hidden="true" className="h-5 w-5" strokeWidth={1.5} />
                    No SAM outline for this photo
                  </span>
                </div>
              )}
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {e.method === "sam-3.1" ? (
                <Pill tone="ok" icon={ScanSearch}>Annotated with SAM 3.1</Pill>
              ) : (
                <Pill tone="neutral" icon={ImageIcon}>Raw photo: not annotated</Pill>
              )}
              {e.note && <span className="text-muted">{e.note}</span>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Customer's message and the photos. Each photo is shown as sent, and beside it the version SAM 3.1
 * outlined when the agent made one. SAM shows what it matched, not a verdict on the damage.
 * A case that was followed up shows each reply (its words, then its photos) after the report,
 * under its round, with the photos numbered across the whole case.
 */
export function EvidenceSection({
  message,
  photos,
  evidence,
  voiceNote,
  inClaim = false,
  integrity,
  integrityMissing,
  followUps = [],
}: {
  message: string;
  /** The photos of the report (the original ones). */
  photos: string[];
  evidence: Evidence[];
  voiceNote?: VoiceNote;
  /** The case carries a carrier claim, so the outlined image really goes into its PDF. */
  inClaim?: boolean;
  /**
   * What the photo integrity check found, on every photo of the case (the replies' included, numbered
   * the same way); absent on cases filed before it existed.
   */
  integrity?: PhotoIntegrity;
  /** Why there is no integrity result, when there is none. */
  integrityMissing?: IntegrityMissing;
  /** The customer's replies, oldest first (round 2 is the first one). */
  followUps?: FollowUp[];
}) {
  // Every photo the customer sent, each with its annotated version when the agent made one.
  const items: Evidence[] = evidenceForPhotos(photos, evidence);
  const replies = followUps.map((f) => ({ followUp: f, items: evidenceForPhotos(f.photos, evidence) }));
  const all = [...items, ...replies.flatMap((r) => r.items)];
  const anyOutlined = all.some((e) => e.annotatedPhoto);
  const followed = followUps.length > 0;
  return (
    <Panel id="evidence-title" title="Customer report and evidence" icon={Camera} index={2}>
      {voiceNote && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {voiceNote.demo ? (
            <Pill tone="warn" icon={Mic}>Voice message: DEMO MODE, canned transcript</Pill>
          ) : (
            <Pill tone="ok" icon={Mic}>Voice message, transcribed by {voiceNote.model}</Pill>
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
      {followed && <Eyebrow className="mb-2">Round 1: the report</Eyebrow>}
      <blockquote className="whitespace-pre-wrap border-l-2 border-border-strong py-1 pl-4 text-lg leading-relaxed text-ink-soft">
        {message}
      </blockquote>

      {all.length === 0 ? (
        <p className="mt-5 flex items-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface-muted px-4 py-3 text-sm text-muted">
          <ImageOff aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          No photo was attached to this report.
        </p>
      ) : (
        <>
          <div className="mt-6 flex items-center gap-2">
            <Eyebrow>Photos</Eyebrow>
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted">{all.length === 1 ? "1 photo" : `${all.length} photos`}</span>
          </div>
          {anyOutlined && (
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The outline is what SAM 3.1 matched on the photo (the item, its pieces or the box), not a verdict on the
              damage. The damage itself is read in the assessment below.
            </p>
          )}
          {items.length > 0 ? (
            <PhotoItems items={items} firstNumber={1} inClaim={inClaim} />
          ) : (
            followed && (
              <p className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface-muted px-4 py-3 text-sm text-muted">
                <ImageOff aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                No photo was attached to the report itself.
              </p>
            )
          )}
        </>
      )}

      {replies.map(({ followUp, items: replyItems }, i) => {
        const firstNumber = items.length + replies.slice(0, i).reduce((n, r) => n + r.items.length, 0) + 1;
        return (
          <div key={followUp.id} data-testid={`follow-up-${i + 2}`} className="mt-8 border-t border-border pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow>Round {i + 2}: the customer replied</Eyebrow>
              <span className="tabular text-xs text-muted">{formatDateTime(followUp.receivedAt)}</span>
              {followUp.simulated && (
                <Pill tone="warn" icon={FlaskConical}>
                  Simulated reply
                </Pill>
              )}
            </div>
            {followUp.simulated && (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Not written by a customer: this is the reply of the demo button, with a photo generated with Meta&apos;s
                Muse Image (data/photos/README.md).
              </p>
            )}
            {followUp.message ? (
              <blockquote className="mt-3 whitespace-pre-wrap border-l-2 border-border-strong py-1 pl-4 text-lg leading-relaxed text-ink-soft">
                {followUp.message}
              </blockquote>
            ) : (
              <p className="mt-3 text-sm text-muted">No message, photos only.</p>
            )}
            {followUp.orderNumber && (
              <p className="mt-3 text-sm text-ink-soft">
                Corrected order number: <span className="font-mono text-[0.8125rem]">{followUp.orderNumber}</span>
              </p>
            )}
            {replyItems.length > 0 && <PhotoItems items={replyItems} firstNumber={firstNumber} inClaim={inClaim} />}
          </div>
        );
      })}
      {/* One row for the whole case: the check covers every photo, the replies' included. */}
      {all.length > 0 && <IntegrityRow integrity={integrity} missing={integrityMissing} />}
    </Panel>
  );
}

export function OrderSection({ order }: { order: Order | null }) {
  return (
    <Panel id="order-title" title="Order" icon={order ? Package : PackageX} index={4}>
      {!order ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-soft">
          <Pill tone="warn" icon={CircleAlert}>Not found</Pill>
          <span className="min-w-0 flex-1 basis-64">
            No order matches the number and e-mail the customer gave, so the agent could not check carrier, value or
            delivery date.
          </span>
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <Fact label="Order">
              <span className="font-mono text-[0.8125rem]">{order.id}</span>
            </Fact>
            <Fact label="Customer">{order.name}</Fact>
            <Fact label="Total">
              <span className="tabular">{formatEur(order.total)}</span>
            </Fact>
            <Fact label="Carrier">{order.service}</Fact>
            <Fact label="Tracking number">
              <span className="font-mono text-xs">{order.trackingNumber}</span>
            </Fact>
            <Fact label="Weight">
              <span className="tabular">{order.weightKg} kg</span>
            </Fact>
            <Fact label="Delivered">{order.deliveredAt ? formatDate(order.deliveredAt) : "Not delivered yet"}</Fact>
            <Fact label="Ship to">
              {order.shippingAddress.city}, {order.shippingAddress.country}
            </Fact>
          </dl>
          <ul className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border text-sm">
            {order.lineItems.map((li) => (
              <li key={li.sku} className="flex items-baseline justify-between gap-3 bg-surface-muted/50 px-4 py-3">
                <span className="min-w-0">
                  {li.quantity} × {li.title}
                </span>
                <span className="tabular shrink-0 text-muted">{formatEur(li.unitPrice * li.quantity)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

export function AssessmentSection({ assessment }: { assessment: DamageAssessment | null }) {
  return (
    <Panel id="assessment-title" title="What the agent saw" icon={ScanEye} index={3}>
      {!assessment ? (
        <p className="text-sm text-muted">The photos were not assessed.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <Fact label="Item">{assessment.item}</Fact>
            <Fact label="Damage">{DAMAGE_TYPE_LABEL[assessment.damageType]}</Fact>
            <Fact label="Severity">{SEVERITY_LABEL[assessment.severity]}</Fact>
            <Fact label="Carrier likely at fault">
              <span className="inline-flex items-center gap-1.5">
                {assessment.carrierLikelyAtFault ? (
                  <Check aria-hidden="true" className="h-4 w-4 text-success" strokeWidth={2.25} />
                ) : (
                  <CircleX aria-hidden="true" className="h-4 w-4 text-muted" strokeWidth={2} />
                )}
                {assessment.carrierLikelyAtFault ? "Yes" : "No"}
              </span>
            </Fact>
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
            <ul className="mt-5 space-y-2 border-t border-border pt-4 text-sm leading-relaxed text-ink-soft">
              {assessment.evidenceNotes.map((n, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
                  <span className="min-w-0">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
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

const FIGURE_FLAG: Record<RuleFigureView["status"], { label: string; tone: Tone; icon: LucideIcon }> = {
  verified: { label: "Verified", tone: "ok", icon: ShieldCheck },
  dated_source: { label: "Dated source", tone: "warn", icon: History },
  unverified: { label: "Unverified", tone: "warn", icon: TriangleAlert },
};

const NOTE_FLAG: Record<Exclude<NoteFlag, null>, { label: string; icon: LucideIcon }> = {
  unverified: { label: "Unverified", icon: TriangleAlert },
  dated_source: { label: "Dated source", icon: History },
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

const DEADLINE_TONE: Record<"none" | "ok" | "soon" | "overdue", { tone: Tone; icon: LucideIcon }> = {
  none: { tone: "neutral", icon: Clock },
  ok: { tone: "neutral", icon: Clock },
  soon: { tone: "warn", icon: Clock },
  overdue: { tone: "danger", icon: TriangleAlert },
};

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
    <Panel id="claim-title" title="Carrier claim" icon={Calculator} index={5}>
      {!claim ? (
        <p className="text-sm text-muted">No claim was computed for this case.</p>
      ) : (
        <>
          <p className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            {claim.eligible ? (
              <Pill tone="ok" icon={CircleCheck}>Eligible</Pill>
            ) : (
              <Pill tone="neutral" icon={CircleX}>Not eligible</Pill>
            )}
            <span className="text-muted">Computed by code from the carrier&apos;s rules, not by the model.</span>
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <Fact label="Max. compensation">
              <span className="tabular font-display text-3xl leading-none text-gold-ink">
                {formatEur(claim.maxCompensationEur)}
              </span>
            </Fact>
            <Fact label="Claim deadline">
              {claim.claimDeadline ? (
                <>
                  {formatDate(claim.claimDeadline)}
                  <span className="mt-0.5 block text-xs text-muted">{deadline.text}</span>
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
            <ul className="mt-5 space-y-2 border-t border-border pt-4 text-sm leading-relaxed text-ink-soft">
              {claim.reasons.map((r, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
                  <span className="min-w-0">{r}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="mt-6 rounded-xl border border-border bg-surface-muted/60 p-4 sm:p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <FileText aria-hidden="true" className="h-4 w-4 text-ink-soft" strokeWidth={1.75} />
          Carrier rules used{rules ? `: ${rules.label}` : ""}
        </h3>
        {!rules ? (
          <p className="mt-2 text-sm text-muted">The carrier rules could not be loaded for this case.</p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              <Fact label="Compensation">{describeCompensation(rules.compensation)}</Fact>
              <Fact label="Reserves within">{rules.reserveDeadlineHours} h of delivery</Fact>
              <Fact label="Claim within">{rules.claimDeadlineDays} days</Fact>
            </dl>
            {rules.requiresRefusal && (
              <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <Pill tone="warn" icon={CircleAlert}>Refusal expected</Pill>
                <span>The carrier expects the customer to refuse a damaged parcel.</span>
              </p>
            )}
            {rules.notes.length > 0 && (
              <ul className="mt-4 space-y-2 text-sm leading-relaxed">
                {rules.notes.map((raw, i) => {
                  const note = noteVerification(raw);
                  const flag = note.flag ? NOTE_FLAG[note.flag] : null;
                  return (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      {flag && <Pill tone="warn" icon={flag.icon}>{flag.label}</Pill>}
                      <span className="min-w-0">{note.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {rules.figures && rules.figures.length > 0 && (
              <>
                <Eyebrow className="mt-6">Figures and how sure we are</Eyebrow>
                <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
                  {rules.figures.map((f) => {
                    const flag = FIGURE_FLAG[f.status];
                    return (
                      <li key={f.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4">
                        <div className="min-w-0">
                          <span className="font-medium text-ink">{f.label}</span>
                          <span className="text-muted">: {f.value}</span>
                          {f.note && <p className="mt-0.5 text-xs text-muted">{f.note}</p>}
                        </div>
                        <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                          <Pill tone={flag.tone} icon={flag.icon}>{flag.label}</Pill>
                          <span className="text-xs text-muted">checked {formatDate(f.checkedOn)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <Eyebrow className="mt-6">Sources</Eyebrow>
            <ul className="mt-2 space-y-2 text-sm">
              {rules.sources.map((s) => {
                const href = safeHref(s.url);
                return (
                  <li key={s.url} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:decoration-accent"
                      >
                        {s.title}
                        <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </a>
                    ) : (
                      <span>{s.title}</span>
                    )}
                    <span className="text-xs text-muted">checked {formatDate(s.checkedOn)}</span>
                    {isStaleSource(s.checkedOn, now) && <Pill tone="warn" icon={History}>Not re-checked recently</Pill>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}

const DECISION_HELP: Record<DecisionKind, string> = {
  reship: "Send the customer a replacement.",
  refund: "Refund the customer.",
  ask_more_photos: "Ask the customer for clearer photos.",
  no_action: "Nothing to do for this report.",
};

/**
 * The agent's decision, the card judges read first: what it chose, the carrier claim, how sure it
 * is, why, whether a human must look, and the money at stake with its deadline. `now` is the
 * clock the case is read against (frozen at the recording for a recorded run).
 */
export function DecisionSection({
  decision,
  claim = null,
  now,
  asOfRecording = false,
}: {
  decision: Decision | null;
  claim?: ClaimComputation | null;
  now: Date;
  /** The deadline is shown as of a recording, not as of today. */
  asOfRecording?: boolean;
}) {
  if (!decision) {
    return (
      <Panel id="decision-title" title="Decision" icon={CircleAlert} className="shadow-raised">
        <p className="text-sm leading-relaxed text-muted">The agent did not reach a decision for this case.</p>
      </Panel>
    );
  }
  const pct = Math.round(Math.min(1, Math.max(0, decision.confidence)) * 100);
  const label = DECISION_LABEL[decision.decision];
  const deadline = deadlineInfo(claim, now);
  const deadlineTone = DEADLINE_TONE[deadline.tone];
  const recoverable = claim?.eligible === true && claim.maxCompensationEur > 0;

  // shrink-0: the card sits in a flex column that scrolls (case-view.tsx). overflow-hidden turns its automatic
  // minimum height into 0, so without it the card was shrunk and cropped (confidence, deadline and maximum
  // amount hidden, "Ask for more" cut mid-word at 1440x900) instead of letting the column scroll. Found 28 Oct 2026.
  return (
    <section
      aria-labelledby="decision-title"
      style={riseStyle(0)}
      className="animate-rise shrink-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-raised"
    >
      <div className="p-5 sm:p-6">
        <h2 id="decision-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Decision
        </h2>

        {decision.needsHuman && (
          <div role="note" className="mt-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-3.5">
            <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface text-warning">
              <UserRoundCheck className="h-4 w-4" strokeWidth={2} />
            </span>
            <p className="min-w-0 pt-1 text-sm leading-relaxed text-ink-soft">
              <strong className="font-semibold text-ink">Needs your judgement.</strong> The agent flagged this case: low
              confidence, high value or signs of fraud.
            </p>
          </div>
        )}

        <p
          data-testid="decision-kind"
          className={cn(
            "mt-4 font-display leading-[1.02] tracking-tight text-ink",
            label.length > 10 ? "text-[2.5rem]" : "text-6xl",
          )}
        >
          {label}
        </p>
        <p className="mt-2 text-sm text-muted">{DECISION_HELP[decision.decision]}</p>

        <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface-muted/70 p-3">
          <IconTile icon={decision.carrierClaim ? FileCheck2 : FileX2} className={decision.carrierClaim ? "bg-surface text-ink" : "bg-surface text-muted"} />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Carrier claim</p>
            <p className="text-sm text-ink">
              <strong className="font-semibold">{decision.carrierClaim ? "yes" : "no"}</strong>
              <span className="text-muted">
                {decision.carrierClaim ? " · a claim is prepared for you" : " · nothing to file with the carrier"}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-xs">
            <span id="confidence-label" className="font-semibold uppercase tracking-[0.14em] text-muted">
              Confidence
            </span>
            <span className="tabular text-sm font-semibold text-ink">{pct}%</span>
          </div>
          <div
            role="meter"
            aria-labelledby="confidence-label"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`${pct} percent`}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
          >
            <div className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {decision.reasons.length > 0 && (
          <div className="mt-5">
            <Eyebrow>Why</Eyebrow>
            <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink-soft">
              {decision.reasons.map((r, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink/40" />
                  <span className="min-w-0">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {claim && (
        <div className="border-t border-border bg-surface-muted/60 p-5 sm:p-6">
          <BorderBeam color="var(--gold)" length={14} thickness={1.5} speed={7} className="rounded-2xl">
            <div className="rounded-2xl border border-gold/30 bg-gold-soft px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-ink">
                Maximum compensation
              </p>
              {recoverable ? (
                <div className="mt-2 [--foreground:var(--gold-ink)] [--text-3xl:3.5rem]">
                  <AnimatedCounter
                    value={claim.maxCompensationEur}
                    prefix="€"
                    decimals={Number.isInteger(claim.maxCompensationEur) ? 0 : 2}
                  />
                </div>
              ) : (
                <p className="mt-2 font-display text-3xl leading-none text-ink-soft">Not recoverable</p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                <Pill tone={deadlineTone.tone} icon={deadlineTone.icon}>{deadline.text}</Pill>
                {claim.claimDeadline && (
                  <span className="text-sm text-ink-soft">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                      Claim by <span className="tabular font-medium text-ink">{formatDate(claim.claimDeadline)}</span>
                    </span>
                  </span>
                )}
              </div>
              {asOfRecording && claim.claimDeadline && (
                <p className="mt-2 text-xs text-muted">Counted as of the recording, not as of today.</p>
              )}
            </div>
          </BorderBeam>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            The most the carrier&apos;s rules allow, worked out by code. Not a promise of payment.
          </p>
        </div>
      )}
    </section>
  );
}

/** The claim PDF (embedded preview, download) and the e-mail that goes with it. */
export function DocumentSection({ caseId, document: doc }: { caseId: string; document: CaseRecord["document"] }) {
  if (!doc) {
    return (
      <Panel id="document-title" title="Claim document" icon={FileX2} index={6}>
        <p className="text-sm text-muted">No claim document: this case does not need a carrier claim.</p>
      </Panel>
    );
  }
  const pdf = `/api/cases/${encodeURIComponent(caseId)}/pdf`;
  return (
    <Panel
      id="document-title"
      title="Claim document"
      icon={FileText}
      index={6}
      action={
        <a href={`${pdf}?download=1`} className={BUTTON_QUIET}>
          <Download aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          Download PDF
        </a>
      }
    >
      <div className="rounded-xl bg-background-deep p-3 sm:p-4">
        <iframe
          title="Carrier claim PDF preview"
          src={pdf}
          className="h-[28rem] w-full rounded-lg bg-white shadow-raised sm:h-[34rem]"
        />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-muted/70 px-4 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <IconTile icon={Mail} className="bg-surface" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-ink">E-mail to the carrier&apos;s claims department</h3>
              <p className="mt-0.5 text-xs text-muted">Ready to send. Gilmend does not send it.</p>
            </div>
          </div>
          <CopyButton
            text={`Subject: ${doc.emailSubject}\n\n${doc.emailBody}`}
            label="Copy e-mail"
            toastTitle="E-mail copied"
          />
        </div>
        <dl className="flex items-baseline gap-4 border-b border-border px-4 py-3 text-sm">
          <dt className="w-[4.5rem] shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Subject</dt>
          <dd className="min-w-0 break-words font-medium text-ink">{doc.emailSubject}</dd>
        </dl>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-4 py-4 font-sans text-sm leading-relaxed text-ink-soft">
          {doc.emailBody}
        </pre>
      </div>
    </Panel>
  );
}

/**
 * The agent's reasoning trace, step by step, on the Arc timeline: who did each step (model, SAM,
 * code), the guardrails that corrected the model, and every tool's input and output on demand.
 */
export function TraceSection({
  trace,
  engine,
  fallbackAt,
  engineOfRound,
}: {
  trace: TraceStep[];
  engine: Engine;
  /** Used for a step whose own date cannot be read. */
  fallbackAt: string;
  /** The engine that ran a given round, when the case was followed up (it can differ between rounds). */
  engineOfRound?: (round: number) => Engine | undefined;
}) {
  const groups = groupTraceByRound(trace);
  return (
    <section
      aria-labelledby="trace-title"
      style={riseStyle(8)}
      className="animate-rise rounded-2xl border border-border bg-surface shadow-card"
    >
      <div className="flex items-center gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <IconTile icon={Route} />
        <h2 id="trace-title" className="text-base font-semibold tracking-tight text-ink">
          Agent reasoning trace
        </h2>
      </div>
      <details open className="group">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl px-5 py-2 text-sm text-muted sm:px-6 [&::-webkit-details-marker]:hidden">
          <span className="tabular">
            {trace.length} {trace.length === 1 ? "step" : "steps"}
          </span>
          <span className="flex items-center gap-2">
            <span className="group-open:hidden">Show trace</span>
            <span className="hidden group-open:inline">Hide trace</span>
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 transition-transform duration-200 group-open:rotate-180"
              strokeWidth={1.75}
            />
          </span>
        </summary>
        <div className="border-t border-border px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
          {trace.length === 0 ? (
            <p className="text-sm text-muted">No steps were recorded.</p>
          ) : (
            <>
              <p className="mb-4 flex items-start gap-2 text-sm leading-relaxed text-muted">
                <Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span>
                  Newest step first: the outcome, then how the agent got there. Amounts and deadlines are worked out by
                  code, never by the model.
                </span>
              </p>
              {groups.length <= 1 ? (
                <TraceTimeline trace={trace} engine={engine} fallbackAt={fallbackAt} />
              ) : (
                // Newest round first, like the steps inside a round: each round has its own clock and its
                // own engine, so each gets its own timeline.
                <div className="flex flex-col gap-8">
                  {[...groups].reverse().map((g) => (
                    <div key={g.round} data-testid={`trace-round-${g.round}`}>
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                        <Repeat2 aria-hidden="true" className="h-4 w-4 text-muted" strokeWidth={1.75} />
                        Round {g.round}
                        <span className="text-xs font-normal text-muted">
                          {g.round === 1 ? "the report" : "the customer's reply"} · {g.steps.length}{" "}
                          {g.steps.length === 1 ? "step" : "steps"}
                        </span>
                      </h3>
                      <TraceTimeline
                        trace={g.steps}
                        engine={engineOfRound?.(g.round) ?? engine}
                        fallbackAt={g.steps[0]?.at ?? fallbackAt}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </details>
    </section>
  );
}
