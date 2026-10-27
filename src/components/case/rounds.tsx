import { ArrowRight, FlaskConical, Inbox, MessageSquareReply, Repeat2, UserRoundCheck } from "lucide-react";
import type { RoundView } from "@/lib/rounds";
import { cn } from "@/lib/utils";
import { EngineBadge } from "../engine-badge";
import { formatDateTime } from "../format";
import { RecordedBadge } from "../recorded-badge";
import { describeRoundChanges, claimAmountLabel, decisionLabel } from "../round-changes";
import { RoundsFocus } from "./rounds-focus";
import { Eyebrow, Panel, Pill } from "./ui";

/**
 * The journey of a case that was followed up: one card per round, oldest first, and under each
 * round after the first what changed since the one before (decision, order, photo quality, the
 * carrier claim). Shown only from round 2: a case with a single round has nothing to compare.
 *
 * Honesty: every round carries the engine that really ran it (a case can start as a recorded real
 * run and continue in a labelled mock, or the other way round), and a reply produced by the
 * "simulate the customer's reply" demo button says it is not something a customer wrote.
 */
export function RoundsSection({ rounds, index = 1 }: { rounds: RoundView[]; index?: number }) {
  if (rounds.length < 2) return null;
  return (
    <Panel
      id="rounds-title"
      title="Rounds of this case"
      icon={Repeat2}
      index={index}
      titleFocusable
      action={<Pill icon={MessageSquareReply}>{rounds.length - 1} customer {rounds.length === 2 ? "reply" : "replies"}</Pill>}
    >
      <RoundsFocus titleId="rounds-title" roundCount={rounds.length} />
      <p className="text-sm leading-relaxed text-muted">
        The customer replied and the agent ran again on this same case, with everything it already knew. The page
        describes the latest round; the earlier ones are kept here.
      </p>
      <ol data-testid="rounds" className="mt-5 flex flex-col">
        {rounds.map((round, i) => {
          const previous = i > 0 ? rounds[i - 1] : null;
          const changes = previous ? describeRoundChanges(previous.outcome, round.outcome) : [];
          const last = i === rounds.length - 1;
          const outcome = round.outcome;
          const amount = claimAmountLabel(outcome);
          return (
            <li key={round.number} data-round={round.number} className="relative flex gap-4 pb-6 last:pb-0">
              {/* The thread that links the rounds: decoration, the order is in the list itself. */}
              {!last && <span aria-hidden="true" className="absolute bottom-0 left-[1.0625rem] top-9 w-px bg-border" />}
              <span
                aria-hidden="true"
                className={cn(
                  "tabular relative z-10 grid h-[2.125rem] w-[2.125rem] shrink-0 place-items-center rounded-full border text-sm font-semibold",
                  round.current ? "border-ink bg-ink text-white" : "border-border-strong bg-surface text-ink-soft",
                )}
              >
                {round.number}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <h3 className="text-sm font-semibold text-ink">
                    Round {round.number}
                    {round.current && <span className="ml-2 text-xs font-medium text-muted">latest</span>}
                  </h3>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                    {round.followUp ? (
                      <MessageSquareReply aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
                    ) : (
                      <Inbox aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
                    )}
                    {round.followUp ? "Customer replied" : "Customer report"}{" "}
                    <span className="tabular">{formatDateTime(round.startedAt)}</span>
                  </span>
                  {outcome && <EngineBadge engine={outcome.engine} detail={outcome.engineDetail} compact />}
                  {outcome?.recorded && <RecordedBadge recorded={outcome.recorded} compact />}
                  {round.followUp?.simulated && (
                    <Pill tone="warn" icon={FlaskConical}>
                      Simulated reply
                    </Pill>
                  )}
                </div>

                {round.followUp && (
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {round.followUp.simulated && (
                      <span className="mb-1 block text-xs text-muted">
                        Not written by a customer: this is the reply of the demo button, with a photo generated with
                        Meta&apos;s Muse Image.
                      </span>
                    )}
                    {round.followUp.message ? (
                      <q className="whitespace-pre-wrap">{round.followUp.message}</q>
                    ) : (
                      <span className="text-muted">No message, photos only.</span>
                    )}
                    <span className="mt-1 block text-xs text-muted">
                      {round.followUp.photos.length === 0
                        ? "No new photo"
                        : round.followUp.photos.length === 1
                          ? "1 new photo"
                          : `${round.followUp.photos.length} new photos`}
                      {round.followUp.orderNumber ? ` · corrected order number ${round.followUp.orderNumber}` : ""}
                    </span>
                  </p>
                )}

                {outcome ? (
                  <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-6 gap-y-3">
                    <div className="min-w-0">
                      <dt>
                        <Eyebrow>Decision</Eyebrow>
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-ink">{decisionLabel(outcome)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt>
                        <Eyebrow>Carrier claim</Eyebrow>
                      </dt>
                      <dd className={cn("tabular mt-1 text-sm font-semibold", amount === "None" ? "text-muted" : "text-gold-ink")}>
                        {amount}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt>
                        <Eyebrow>Needs a human</Eyebrow>
                      </dt>
                      <dd className="mt-1 inline-flex items-center gap-1.5 text-sm text-ink">
                        {outcome.decision?.needsHuman ? (
                          <>
                            <UserRoundCheck aria-hidden="true" className="h-4 w-4 text-warning" strokeWidth={2} />
                            Yes
                          </>
                        ) : (
                          "No"
                        )}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-3 text-sm text-muted">The record of this round was not kept.</p>
                )}

                {previous && (
                  <div data-testid={`round-${round.number}-changes`} className="mt-4 rounded-xl border border-border bg-surface-muted/70 p-3.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                      What changed since round {previous.number}
                    </p>
                    {changes.length === 0 ? (
                      <p className="mt-2 text-sm text-ink-soft">Nothing: same decision, same figures.</p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {changes.map((c) => (
                          <li key={c.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                            <span className="font-medium text-ink">{c.label}:</span>
                            <span className="text-muted line-through decoration-border-strong">{c.from}</span>
                            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 self-center text-muted" strokeWidth={2} />
                            <span className="sr-only">became</span>
                            <span className={cn("font-semibold", c.money ? "tabular text-gold-ink" : "text-ink")}>{c.to}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
