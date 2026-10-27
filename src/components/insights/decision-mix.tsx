import type { Insights } from "@/lib/impact/insights";
import { DECISION_LABEL } from "../format";
import { Panel } from "./panel";

/**
 * The decisions the agent reached. Counts, not money: the bars are ink (docs/design.md keeps gold
 * for money), and each row prints its count and share, so the bars are decoration.
 */
export function DecisionMix({ decisions }: { decisions: Insights["decisions"] }) {
  const { total, items, needsHuman, withCarrierClaim } = decisions;
  return (
    <Panel
      id="insights-decisions"
      title="What the agent decided"
      description="One decision per case: reship, refund, ask for better photos, or nothing to do."
    >
      {total === 0 ? (
        <p className="text-sm text-muted">No decision yet.</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {items.map((d) => (
            <li key={d.decision} data-testid={`decision-${d.decision}`}>
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-sm font-medium text-ink">{DECISION_LABEL[d.decision]}</p>
                <p className="tabular shrink-0 text-sm text-ink-soft">
                  <span className="font-semibold">{d.count}</span>
                  <span className="text-muted">{` · ${Math.round(d.share * 100)}%`}</span>
                </p>
              </div>
              <div aria-hidden="true" className="mt-2 h-2.5 overflow-hidden rounded-full bg-ink/[0.07]">
                <div className="h-full rounded-full bg-ink-soft" style={{ width: `${d.share * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="tabular border-t border-border pt-4 text-sm text-muted">
        {total} {total === 1 ? "case" : "cases"} with a decision · {withCarrierClaim} with a carrier claim ·{" "}
        {needsHuman} handed to a human
      </p>
    </Panel>
  );
}
