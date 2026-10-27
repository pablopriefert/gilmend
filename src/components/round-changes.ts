import type { RoundOutcome } from "@/lib/rounds";
import { DAMAGE_TYPE_LABEL, DECISION_LABEL, PHOTO_QUALITY_LABEL, formatEur } from "./format";

// What moved between two rounds of a case, as short strings the page can show side by side
// ("Decision: Ask for more photos -> Reship"). Only what really differs is listed: a round that
// changed nothing says so on the page instead of repeating a table of equal values.

export type RoundChangeKey = "decision" | "order" | "damage" | "photos" | "claim" | "human";

export interface RoundChange {
  key: RoundChangeKey;
  label: string;
  from: string;
  to: string;
  /** True when `to` is money the merchant can recover: the page writes it in the money colour. */
  money?: boolean;
}

/** "Up to EUR 102.30" when the round prepared a carrier claim, else "None". */
export function claimAmountLabel(o: RoundOutcome | null): string {
  if (!o || !o.decision?.carrierClaim || !o.claim?.eligible || !(o.claim.maxCompensationEur > 0)) return "None";
  return `Up to ${formatEur(o.claim.maxCompensationEur, { whole: false })}`;
}

export function decisionLabel(o: RoundOutcome | null): string {
  return o?.decision ? DECISION_LABEL[o.decision.decision] : "No decision";
}

const orderLabel = (o: RoundOutcome | null): string => (o?.order ? `${o.order.id} found` : "Not found");
const damageLabel = (o: RoundOutcome | null): string =>
  o?.assessment ? DAMAGE_TYPE_LABEL[o.assessment.damageType] : "Not read";
const photoLabel = (o: RoundOutcome | null): string =>
  o?.assessment ? PHOTO_QUALITY_LABEL[o.assessment.photoQuality] : "Not read";
const humanLabel = (o: RoundOutcome | null): string => (o?.decision?.needsHuman ? "Yes" : "No");

/** The differences between two rounds, in the order a merchant cares about: decision first, money next. */
export function describeRoundChanges(from: RoundOutcome | null, to: RoundOutcome | null): RoundChange[] {
  const rows: RoundChange[] = [
    { key: "decision", label: "Decision", from: decisionLabel(from), to: decisionLabel(to) },
    { key: "order", label: "Order", from: orderLabel(from), to: orderLabel(to) },
    { key: "damage", label: "Damage read", from: damageLabel(from), to: damageLabel(to) },
    { key: "photos", label: "Photo quality", from: photoLabel(from), to: photoLabel(to) },
    {
      key: "claim",
      label: "Carrier claim",
      from: claimAmountLabel(from),
      to: claimAmountLabel(to),
      money: claimAmountLabel(to) !== "None",
    },
    { key: "human", label: "Needs a human", from: humanLabel(from), to: humanLabel(to) },
  ];
  return rows.filter((r) => r.from !== r.to);
}
