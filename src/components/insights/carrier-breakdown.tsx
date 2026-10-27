import type { CarrierInsight } from "@/lib/impact/insights";
import { CARRIER_LABEL, formatEur } from "../format";
import { Panel } from "./panel";

/**
 * Money still claimable, per carrier. The bars are gold because they are money (docs/design.md);
 * they are drawn from the same figures the rows print, so hiding them from assistive technology
 * loses nothing: every row says the carrier, the window, the number of claims and the amount.
 */
export function CarrierBreakdown({
  carriers,
  totalEur,
  openClaims,
}: {
  carriers: CarrierInsight[];
  totalEur: number;
  openClaims: number;
}) {
  const max = Math.max(...carriers.map((c) => c.recoverableEur), 0);
  return (
    <Panel
      id="insights-carriers"
      title="Money still claimable, by carrier"
      description="Ceilings set by each carrier's rules, for claims you have not rejected. The carrier decides what it pays."
    >
      <ul className="flex flex-col gap-5">
        {carriers.map((c) => {
          const width = max > 0 && c.recoverableEur > 0 ? Math.max(3, (c.recoverableEur / max) * 100) : 0;
          return (
            <li key={c.carrier} data-testid={`carrier-${c.carrier}`}>
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{CARRIER_LABEL[c.carrier]}</p>
                  <p className="text-xs text-muted">Claim window: {c.windowLabel}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular text-sm font-semibold text-gold-ink">
                    {c.openClaims > 0 ? formatEur(c.recoverableEur) : "No open claim"}
                  </p>
                  {c.openClaims > 0 && (
                    <p className="tabular text-xs text-muted">
                      {c.openClaims} {c.openClaims === 1 ? "claim" : "claims"}
                    </p>
                  )}
                </div>
              </div>
              <div aria-hidden="true" className="mt-2 h-2.5 overflow-hidden rounded-full bg-gold-soft">
                <div className="h-full rounded-full bg-gold" style={{ width: `${width}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="tabular flex items-baseline justify-between gap-4 border-t border-border pt-4 text-sm">
        <span className="font-medium text-ink">
          Total, {openClaims} {openClaims === 1 ? "claim" : "claims"}
        </span>
        <span data-testid="insights-total" className="font-display text-xl text-gold-ink">
          {formatEur(totalEur)}
        </span>
      </p>
    </Panel>
  );
}
