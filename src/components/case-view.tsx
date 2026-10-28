import { Archive, Clock, EyeOff, FlaskConical, GitFork, Hourglass, Repeat2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { caseRound, followUpAvailability, followUpsOf, getRounds, hasSimulatedReply } from "@/lib/rounds";
import type { CaseRecord, Engine, EngineDetail } from "@/lib/types";
import { CaseReviewProvider, ReplyCard, ReviewActions } from "./case-review-panel";
import {
  AssessmentSection,
  ClaimSection,
  DecisionSection,
  DocumentSection,
  EvidenceSection,
  OrderSection,
  TraceSection,
  type RulesView,
} from "./case-sections";
import { ClaimFiledNote } from "./case/claim-filed";
import { RoundsSection } from "./case/rounds";
import { BackLink, Note, Pill, riseStyle } from "./case/ui";
import { StatusChip } from "./case/status-chip";
import { isBlurryLampCase } from "./demo-scenarios";
import { EngineBadge } from "./engine-badge";
import { FollowUpPanel } from "./follow-up-panel";
import { caseClock, formatDate, formatDateTime } from "./format";
import { RecordedBadge } from "./recorded-badge";

/** The trace line the agent writes when the model was never shown the photos (see run-agent.ts). */
const PHOTOS_NOT_READ = /NOT read by the model/i;

/**
 * One case, top to bottom: header, then the decision and the human's actions on the right
 * (first on a phone), the evidence and the numbers on the left, and the reasoning trace.
 * `rules` is null when the carrier rules could not be loaded; the page says so.
 */
export function CaseView({
  caseRecord: c,
  rules,
  now,
  accessCodeRequired = false,
  followUpEngine,
}: {
  caseRecord: CaseRecord;
  rules: RulesView | null;
  now: Date;
  /** The server asks for an access code before a case can be changed. */
  accessCodeRequired?: boolean;
  /**
   * What the server will really run a follow-up on (the engine of the case, or the labelled mock when
   * its credentials are missing here). Defaults to the engine the case was run with.
   */
  followUpEngine?: { engine: Engine; detail?: EngineDetail };
}) {
  const clock = caseClock(c, now);
  const rounds = getRounds(c);
  const round = caseRound(c);
  const followUp = followUpAvailability(c);
  const simulatedReply = hasSimulatedReply(c);
  const photosNotRead = c.trace.find((s) => PHOTOS_NOT_READ.test(s.step));
  const title = c.order?.name ?? c.report.customerEmail;
  const integritySignals = c.integrity?.signals.length ?? 0;
  return (
    <CaseReviewProvider
      caseId={c.id}
      initialStatus={c.status}
      initialReply={c.decision?.customerReply ?? ""}
      // Follows the server-side case after an action (router.refresh) without remounting the page.
      syncKey={`${c.status}-${c.updatedAt}`}
      language={c.report.language}
      hasDecision={Boolean(c.decision)}
      accessCodeRequired={accessCodeRequired}
    >
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-5">
          <div>
            <BackLink />
            <h1 className="mt-2">
              <span className="block font-mono text-sm tracking-wide text-muted">{c.order?.id ?? c.report.orderNumber}</span>
              <span
                className={
                  c.order
                    ? "mt-1 block break-words font-display text-[2.25rem] leading-[1.05] tracking-tight text-ink sm:text-5xl"
                    : "mt-1 block break-all font-display text-[2.25rem] leading-[1.05] tracking-tight text-ink sm:text-5xl"
                }
              >
                {title}
              </span>
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusChip status={c.status} />
              <EngineBadge engine={c.engine} detail={c.engineDetail} />
              {c.recorded && <RecordedBadge recorded={c.recorded} />}
              {round > 1 && (
                <Pill icon={Repeat2} data-testid="round-chip">
                  Round {round}: the customer replied
                </Pill>
              )}
              <span className="inline-flex items-center gap-1.5 px-1 text-sm text-muted">
                <Clock aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                Reported <span className="tabular">{formatDateTime(c.report.receivedAt)}</span>
              </span>
            </div>
          </div>

          {(c.status === "new" ||
            photosNotRead ||
            integritySignals > 0 ||
            c.recorded ||
            c.followedFrom ||
            simulatedReply ||
            c.engine === "demo-mock") && (
            <div className="flex flex-col gap-3">
              {c.status === "new" && (
                <Note tone="warn" icon={Hourglass} className="animate-rise" style={riseStyle(0)}>
                  <strong>The agent has not finished this case.</strong> It is either still running (reload in a
                  moment) or was interrupted: the report and the photos are saved, and you can handle the case by
                  hand.
                </Note>
              )}
              {photosNotRead && (
                <Note tone="warn" icon={EyeOff} className="animate-rise" style={riseStyle(1)}>
                  <strong>Photos not read.</strong> {photosNotRead.step}
                </Note>
              )}
              {integritySignals > 0 && (
                <Note tone="warn" icon={ShieldAlert} data-testid="integrity-note" className="animate-rise" style={riseStyle(2)}>
                  <strong>
                    Photo integrity: {integritySignals === 1 ? "1 signal" : `${integritySignals} signals`}.
                  </strong>{" "}
                  A person must check the photos before anything is filed or sent. A signal is a reason to look, not a
                  verdict on the customer: see the Integrity row under the photos.
                </Note>
              )}
              {c.recorded && (
                <Note tone="info" icon={Archive} data-testid="recorded-note" className="animate-rise" style={riseStyle(2)}>
                  <strong>Recorded run.</strong> This is a real run of Muse Spark 1.3 and SAM 3.1 on the Meta Model API,
                  recorded on {formatDate(`${c.recorded.recordedOn}T12:00:00Z`)} and saved with the code. Nothing here was re-run for this page, and the deadlines are shown as of the recording. The
                  customer photos were generated with Meta&apos;s Muse Image for this demo (data/photos/README.md); Muse Spark and SAM ran on exactly these images. The
                  recording itself is read-only: approving, editing or rejecting it stores a copy.
                </Note>
              )}
              {c.followedFrom && (
                <Note tone="info" icon={GitFork} data-testid="followed-from-note" className="animate-rise" style={riseStyle(3)}>
                  <strong>This case continues a recorded run.</strong> Round 1 below is a copy of that recording; the
                  recording itself was not changed.{" "}
                  <Link href={`/cases/${c.followedFrom}`} className="font-semibold underline underline-offset-4">
                    Open the recording
                  </Link>
                </Note>
              )}
              {simulatedReply && (
                <Note tone="warn" icon={FlaskConical} data-testid="simulated-reply-note" className="animate-rise" style={riseStyle(3)}>
                  <strong>Simulated reply.</strong> A reply on this case comes from the demo button: the message was
                  written by us and the photo was generated with Meta&apos;s Muse Image. No customer wrote it. The case
                  is not counted in the totals of the cases page, and its claim PDF says so.
                </Note>
              )}
              {c.engine === "demo-mock" && (
                <Note tone="warn" icon={FlaskConical} className="animate-rise" style={riseStyle(3)}>
                  <strong>Demo mode.</strong>{" "}
                  {round > 1 ? "The latest round of this case was" : "This case was"} produced by a deterministic mock, not
                  by Muse. The decision, reasons and reply below are canned; the amounts and deadlines still come from
                  the real carrier rules.
                </Note>
              )}
            </div>
          )}
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
          {/* Mobile: the decision and the actions come first. Desktop: a sticky right column. */}
          <div className="flex flex-col gap-6 lg:sticky lg:top-24 lg:order-2 lg:-mx-1 lg:max-h-[calc(100dvh-7.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:px-1 lg:pb-2">
            <DecisionSection decision={c.decision} claim={c.claim} now={clock} asOfRecording={Boolean(c.recorded)} />
            <ReviewActions />
            {c.claimFiledAt && <ClaimFiledNote caseId={c.id} filedAt={c.claimFiledAt} />}
          </div>
          <div className="flex min-w-0 flex-col gap-6 lg:order-1">
            {followUp.available && (
              <FollowUpPanel
                // A new round remounts the form: nothing typed for round 2 is carried into round 3.
                key={round}
                caseId={c.id}
                round={round}
                missing={followUp.missing}
                asked={c.decision?.customerReply ?? ""}
                orderMissing={c.order === null}
                runsAs={followUpEngine ?? { engine: c.engine, detail: c.engineDetail }}
                demoReply={isBlurryLampCase(c)}
                index={1}
              />
            )}
            <RoundsSection rounds={rounds} index={1} />
            <EvidenceSection
              message={c.report.message}
              photos={c.report.photos}
              evidence={c.evidence}
              voiceNote={c.report.voiceNote}
              inClaim={c.decision?.carrierClaim === true}
              integrity={c.integrity}
              integrityMissing={c.recorded ? "recorded" : c.status === "new" ? "unfinished" : "absent"}
              followUps={followUpsOf(c)}
            />
            <AssessmentSection assessment={c.assessment} />
            <OrderSection order={c.order} />
            <ClaimSection claim={c.claim} rules={rules} now={clock} decision={c.decision} />
            <DocumentSection caseId={c.id} document={c.document} />
            <ReplyCard index={7} />
            <TraceSection
              trace={c.trace}
              engine={c.engine}
              fallbackAt={c.createdAt}
              engineOfRound={(n) => rounds.find((r) => r.number === n)?.outcome?.engine}
            />
          </div>
        </div>
      </div>
    </CaseReviewProvider>
  );
}
