import Link from "next/link";
import type { CaseRecord } from "@/lib/types";
import { CaseReviewPanel } from "./case-review-panel";
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
import { EngineBadge } from "./engine-badge";
import { caseClock, formatDate, formatDateTime } from "./format";
import { RecordedBadge } from "./recorded-badge";
import { StatusPill } from "./status-pill";

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
}: {
  caseRecord: CaseRecord;
  rules: RulesView | null;
  now: Date;
  /** The server asks for an access code before a case can be changed. */
  accessCodeRequired?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm font-medium text-accent underline-offset-2 hover:underline">
          ← All cases
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {c.order?.id ?? c.report.orderNumber}
            <span className="font-normal text-muted"> · {c.order?.name ?? c.report.customerEmail}</span>
          </h1>
          <StatusPill status={c.status} />
          <EngineBadge engine={c.engine} detail={c.engineDetail} />
          {c.recorded && <RecordedBadge recorded={c.recorded} />}
        </div>
        <p className="mt-1 text-sm text-muted">Reported {formatDateTime(c.report.receivedAt)}</p>
        {c.status === "new" && (
          <p role="note" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <strong>The agent has not finished this case.</strong> It is either still running (reload in a
            moment) or was interrupted: the report and the photos are saved, and you can handle the case by
            hand.
          </p>
        )}
        {c.recorded && (
          <p role="note" data-testid="recorded-note" className="mt-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-950">
            <strong>Recorded run.</strong> This is a real run of Muse Spark 1.3 and SAM 3.1 on the Meta Model API,
            recorded on {formatDate(`${c.recorded.recordedOn}T12:00:00Z`)} and saved with the code. Nothing here was re-run for this page, and the deadlines are shown as of the recording. The
            customer photos are provisional AI-generated stand-ins (data/photos/README.md); Muse and SAM ran on exactly these images. The
            recording itself is read-only: approving, editing or rejecting it stores a copy.
          </p>
        )}
        {c.engine === "demo-mock" && (
          <p role="note" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <strong>Demo mode.</strong> This case was produced by a deterministic mock, not by Muse. The
            decision, reasons and reply below are canned; the amounts and deadlines still come from the real
            carrier rules.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-6 lg:sticky lg:top-6 lg:order-2 lg:self-start">
          <DecisionSection decision={c.decision} />
          <CaseReviewPanel
            // Remount when the server-side case changes (a refresh after an action).
            key={`${c.status}-${c.updatedAt}`}
            caseId={c.id}
            initialStatus={c.status}
            initialReply={c.decision?.customerReply ?? ""}
            language={c.report.language}
            hasDecision={Boolean(c.decision)}
            accessCodeRequired={accessCodeRequired}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:order-1">
          <EvidenceSection message={c.report.message} photos={c.report.photos} evidence={c.evidence} voiceNote={c.report.voiceNote} />
          <AssessmentSection assessment={c.assessment} />
          <OrderSection order={c.order} />
          <ClaimSection claim={c.claim} rules={rules} now={caseClock(c, now)} />
          <DocumentSection caseId={c.id} document={c.document} />
          <TraceSection trace={c.trace} />
        </div>
      </div>
    </div>
  );
}
