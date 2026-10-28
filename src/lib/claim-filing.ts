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
