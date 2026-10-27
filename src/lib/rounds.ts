import type {
  CaseRecord,
  CaseStatus,
  DamageReport,
  FollowUp,
  PreviousRound,
  RecordedRun,
  TraceStep,
} from "./types";

// The follow-up loop (28 Oct 2026): a case that ends in "ask for more photos" (or that needs a
// piece of information only the customer has) is not a dead end. The customer replies, the merchant
// adds the reply to the SAME case, and the agent resumes with everything it knew (resumeAgent).
//
// How a case stores its rounds, so that nothing that reads a case had to change:
//  - `report` stays the original report, untouched;
//  - the top-level fields (assessment, claim, decision, evidence, document, engine, status, trace)
//    always describe the LATEST round;
//  - `followUps[i]` is what the customer sent to start round i + 2;
//  - `previousRounds[i]` is the outcome of round i + 1 that the next round replaced.
// A case with neither field is a round-1 case, which is every case saved before this existed
// and the six committed recorded runs: they are read as a single round, never rewritten.
// Pure functions only (no node APIs): the case page and the routes both use them.

/** Replies a case accepts. Each one can spend a model run, so the loop is bounded. */
export const MAX_FOLLOW_UPS = 3;
/** New photos per reply (the same ceiling as a report). */
export const MAX_FOLLOW_UP_PHOTOS = 3;
export const MAX_FOLLOW_UP_MESSAGE_CHARS = 2000;

export function followUpsOf(c: Pick<CaseRecord, "followUps">): FollowUp[] {
  return c.followUps ?? [];
}

/**
 * True when one of the customer's replies is the rehearsal of the "simulate the customer's reply" demo
 * button (a message we wrote and a photo generated with Muse Image), not something a customer sent.
 * Whatever a later round says, money found on such a case is not money a customer's damage produced:
 * the dashboard counters leave it out and say so, and the claim PDF labels the photos it added.
 */
export function hasSimulatedReply(c: Pick<CaseRecord, "followUps">): boolean {
  return followUpsOf(c).some((f) => f.simulated === true);
}

/** The round the case is in now: 1 for the original report, 2 after the first reply... */
export function caseRound(c: Pick<CaseRecord, "followUps">): number {
  return 1 + followUpsOf(c).length;
}

/** Every photo of the case, in the order the customer sent them: the report's, then each reply's. */
export function allPhotos(c: Pick<CaseRecord, "report" | "followUps">): string[] {
  return [...c.report.photos, ...followUpsOf(c).flatMap((f) => f.photos)];
}

/** The order number to look up: the latest correction the customer made, else the one in the report. */
export function quotedOrderNumber(c: Pick<CaseRecord, "report" | "followUps">): string {
  const corrections = followUpsOf(c)
    .map((f) => f.orderNumber?.trim())
    .filter((n): n is string => Boolean(n));
  return corrections.at(-1) ?? c.report.orderNumber;
}

/**
 * The outcome of one round: what the agent concluded and produced. Same fields as PreviousRound
 * minus the bookkeeping, so the page reads every round the same way.
 */
export type RoundOutcome = Omit<PreviousRound, "number" | "status">;

export interface RoundView {
  number: number;
  /** What the customer sent to start this round. Null for round 1: that is the report itself. */
  followUp: FollowUp | null;
  /** When the round started: the report, or the reply. */
  startedAt: string;
  /** The case status when the round ended (for the latest round: the status now). */
  status: CaseStatus;
  /** Null only when a case was edited by hand and lost the record of that round. */
  outcome: RoundOutcome | null;
  /** True for the latest round: the one the top-level fields of the case describe. */
  current: boolean;
}

function outcomeOf(c: CaseRecord): RoundOutcome {
  return {
    order: c.order,
    assessment: c.assessment,
    claim: c.claim,
    decision: c.decision,
    evidence: c.evidence,
    document: c.document,
    engine: c.engine,
    ...(c.engineDetail ? { engineDetail: c.engineDetail } : {}),
    ...(c.recorded ? { recorded: c.recorded as RecordedRun } : {}),
    finishedAt: c.updatedAt,
  };
}

/**
 * Every round of a case, oldest first. A case without follow-ups gives exactly one round whose
 * outcome is the case itself: that is how the committed recordings and every older case read.
 */
export function getRounds(c: CaseRecord): RoundView[] {
  const total = caseRound(c);
  const replies = followUpsOf(c);
  const earlier = c.previousRounds ?? [];
  const views: RoundView[] = [];
  for (let number = 1; number <= total; number++) {
    const followUp = number === 1 ? null : (replies[number - 2] ?? null);
    const startedAt = followUp ? followUp.receivedAt : c.report.receivedAt;
    if (number === total) {
      views.push({ number, followUp, startedAt, status: c.status, outcome: outcomeOf(c), current: true });
      continue;
    }
    const kept = earlier.find((p) => p.number === number) ?? null;
    views.push({
      number,
      followUp,
      startedAt,
      status: kept?.status ?? "needs_review",
      outcome: kept
        ? {
            order: kept.order,
            assessment: kept.assessment,
            claim: kept.claim,
            decision: kept.decision,
            evidence: kept.evidence,
            document: kept.document,
            engine: kept.engine,
            ...(kept.engineDetail ? { engineDetail: kept.engineDetail } : {}),
            ...(kept.recorded ? { recorded: kept.recorded } : {}),
            finishedAt: kept.finishedAt,
          }
        : null,
      current: false,
    });
  }
  return views;
}

/** The current round of a case, frozen as a PreviousRound: what the next round replaces. */
export function snapshotRound(c: CaseRecord): PreviousRound {
  return { number: caseRound(c), status: c.status, ...outcomeOf(c) };
}

/**
 * The report the agent works on in a follow-up round: the original report with every photo of the
 * case so far plus the new ones, and the order number the customer corrected, if they did. The
 * time it was received stays the ORIGINAL one: the carrier's reserve window is about when the
 * customer first reported the damage, and a reply days later must not move it (computeClaim reads
 * the delivery date from the order and the real clock for the filing deadline, never the date of
 * the reply).
 */
export function workingReport(c: CaseRecord, followUp: FollowUp): DamageReport {
  return {
    ...c.report,
    orderNumber: followUp.orderNumber?.trim() || quotedOrderNumber(c),
    photos: [...allPhotos(c), ...followUp.photos],
  };
}

/** What the agent asked the customer for: the reason a reply can be added to a case. */
export type MissingInfo = "photos" | "order";

export type FollowUpUnavailable =
  /** The agent has not finished (status "new") or failed before a decision: nothing was asked yet. */
  | "no_decision"
  /** The merchant rejected the case: it is closed. Reopen it first. */
  | "closed"
  /** The decision does not ask the customer for anything. */
  | "not_needed"
  /** MAX_FOLLOW_UPS replies were already added. */
  | "limit";

export type FollowUpAvailability =
  | {
      available: true;
      /** What is missing, in the agent's words: more photos, and/or an order number that matched nothing. */
      missing: MissingInfo[];
      /** The round a reply would start. */
      nextRound: number;
    }
  | { available: false; reason: FollowUpUnavailable };

/**
 * Whether the merchant can add the customer's reply to this case. The "Customer replied" panel
 * shows when it is true and POST /api/cases/[id]/follow-up refuses (409) when it is not, so the
 * screen and the server say the same thing:
 *  - the decision is "ask for more photos", or a human is needed because the photos cannot be
 *    read or the order cannot be found (information only the customer can give);
 *  - the case is not rejected (an approved "ask for more photos" is the normal moment: the
 *    request went out and the customer answered) and has room for another reply.
 */
export function followUpAvailability(c: CaseRecord): FollowUpAvailability {
  const decision = c.decision;
  if (!decision) return { available: false, reason: "no_decision" };
  if (c.status === "rejected" || c.status === "sent_to_customer") return { available: false, reason: "closed" };
  if (followUpsOf(c).length >= MAX_FOLLOW_UPS) return { available: false, reason: "limit" };

  const missing: MissingInfo[] = [];
  const photosUnusable =
    c.assessment !== null && (c.assessment.photoQuality !== "ok" || c.assessment.damageType === "unclear");
  if (decision.decision === "ask_more_photos" || (decision.needsHuman && photosUnusable)) missing.push("photos");
  if (decision.needsHuman && c.order === null) missing.push("order");
  if (missing.length === 0) return { available: false, reason: "not_needed" };
  return { available: true, missing, nextRound: caseRound(c) + 1 };
}

/** The sentence the 409 of the route and the page use for each reason a reply cannot be added. */
export const FOLLOW_UP_UNAVAILABLE_MESSAGE: Record<FollowUpUnavailable, string> = {
  no_decision: "The agent has not produced a decision for this case yet, so there is nothing for the customer to answer.",
  closed: "This case is rejected. Reopen it for review before adding the customer's reply.",
  not_needed: "The agent did not ask the customer for anything on this case (no request for photos or for an order number).",
  limit: `This case already holds ${MAX_FOLLOW_UPS} replies from the customer, the most Gilmend takes. A person should handle it from here.`,
};

/**
 * The trace of a case cut into its rounds, oldest first. A step with no `round` belongs to round 1
 * (every trace saved before follow-ups existed). The steps keep their order inside a round.
 */
export function groupTraceByRound(trace: TraceStep[]): { round: number; steps: TraceStep[] }[] {
  const groups: { round: number; steps: TraceStep[] }[] = [];
  for (const step of trace) {
    const round = step.round ?? 1;
    const last = groups.at(-1);
    if (last && last.round === round) last.steps.push(step);
    else groups.push({ round, steps: [step] });
  }
  return groups;
}
