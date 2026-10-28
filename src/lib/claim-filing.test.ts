import { describe, expect, it } from "vitest";
import { claimIsDeclined, claimIsOpen } from "./claim-filing";
import { fauxCase } from "./store/faux-cases";
import { summarizeCases } from "./store/summary";

const NOW = new Date("2026-10-30T12:00:00.000Z");

describe("claimIsDeclined: the rules found a claim, the agent did not make it (28 Oct 2026)", () => {
  it("is true for an eligible claim with carrierClaim=false, and never open at the same time", () => {
    const c = fauxCase({ id: "a", carrierClaim: false, claim: { maxCompensationEur: 89 } });
    expect(claimIsDeclined(c)).toBe(true);
    expect(claimIsOpen(c)).toBe(false);
  });

  it("is false when the agent claims, when there is no decision yet, and when the claim is not eligible", () => {
    expect(claimIsDeclined(fauxCase({ id: "b", carrierClaim: true }))).toBe(false);
    expect(claimIsDeclined(fauxCase({ id: "c", carrierClaim: null }))).toBe(false);
    expect(claimIsDeclined(fauxCase({ id: "d", carrierClaim: false, claim: { eligible: false } }))).toBe(false);
    expect(claimIsDeclined(fauxCase({ id: "e", carrierClaim: false, claim: null }))).toBe(false);
  });

  it("agrees with the dashboard counter: a declined claim is never money to recover", () => {
    const declined = fauxCase({ id: "x", status: "approved", carrierClaim: false, claim: { maxCompensationEur: 89 } });
    const claimed = fauxCase({ id: "y", status: "approved", carrierClaim: true, claim: { maxCompensationEur: 40 } });
    expect(claimIsDeclined(declined)).toBe(true);
    expect(summarizeCases([declined], NOW).recoverableThisMonthEur).toBe(0);
    expect(summarizeCases([declined, claimed], NOW).recoverableThisMonthEur).toBe(40);
  });
});
