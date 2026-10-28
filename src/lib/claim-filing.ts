import type { CaseRecord } from "./types";

// One definition of "a carrier claim is waiting to be filed" (29 Oct 2026), shared by the route that
// takes the merchant's "I filed it" note (PATCH /api/cases/[id]) and by the morning sweep, so the two
// never disagree about when the button may appear.

/**
 * The claim exists, can be made now, and the agent did not decide against it. A claim that is not
 * eligible YET (blurry photos) is not open: there is nothing to file until the evidence is there.
 * Says nothing about the merchant's click or about the deadline.
 */
export function claimIsOpen(c: Pick<CaseRecord, "claim" | "decision">): boolean {
  return c.claim?.eligible === true && c.decision?.carrierClaim !== false;
}

/** An approved case whose claim is open: the only kind the merchant can mark as filed. */
export function claimIsFileable(c: Pick<CaseRecord, "status" | "claim" | "decision">): boolean {
  return c.status === "approved" && claimIsOpen(c);
}

/**
 * The rules computed an eligible claim, but the agent decided NOT to claim the carrier (28 Oct 2026:
 * an integrity signal with "ask for more photos" left the case page saying "Carrier claim no ·
 * nothing to file" above "Maximum compensation €89 · 2 days left · Claim by ..."). The computed amount
 * is then what the rules would allow, never something to claim: the pages show it as "not claimed", and
 * no deadline is presented as live. False when there is no decision yet (the claim may still be
 * kept) or when the claim is not eligible (that has its own wording).
 */
export function claimIsDeclined(c: Pick<CaseRecord, "claim" | "decision">): boolean {
  return c.claim?.eligible === true && c.decision != null && c.decision.carrierClaim === false;
}
