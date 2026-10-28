import { describe, expect, it } from "vitest";
import { buildClaimEmail, carrierClaimChannel, getMerchant } from "./claim-email";
import { formatDate, formatMoney } from "./format";
import { sampleCase } from "./test-helpers";

const merchant = getMerchant({});

describe("buildClaimEmail", () => {
  it("carries the tracking number, the order, the amount and the deadline", () => {
    const { subject, body } = buildClaimEmail(sampleCase(), merchant);
    expect(subject).toBe("Damage claim - parcel 6A12345678901 - order #1042");
    expect(body).toContain("€9.20");
    expect(body).toContain("30 October 2026");
    expect(body).toContain("6A12345678901");
    expect(body).toContain("Dear Sir or Madam,");
    expect(body).toContain(merchant.name);
  });

  it("mentions the reserve deadline only when the carrier has one", () => {
    const base = sampleCase();
    expect(buildClaimEmail(base, merchant).body).toContain("Reserve deadline");
    const without = sampleCase({ claim: { ...base.claim!, reserveDeadline: null } });
    expect(buildClaimEmail(without, merchant).body).not.toContain("Reserve");
  });

  it("describes the damage in English from the structured assessment", () => {
    const { body } = buildClaimEmail(sampleCase(), merchant);
    expect(body).toContain("Ceramic vase (product broken or damaged, product beyond repair)");
  });

  it("words the declaration after what happened, not always 'damage found at delivery'", () => {
    const base = sampleCase();
    const text = (damageType: NonNullable<typeof base.assessment>["damageType"]) =>
      buildClaimEmail(sampleCase({ assessment: { ...base.assessment!, damageType } }), merchant);

    // Found on opening a parcel that looked intact (case 1): not "found at delivery".
    expect(text("broken_product").body).toContain("damage found when the parcel was opened");
    expect(text("broken_product").body).not.toContain("at delivery.");
    // Delivered open with an article missing (case 4): partial loss, not damage.
    const lost = text("opened_parcel");
    expect(lost.body).toContain("a parcel delivered open with an item missing (partial loss)");
    expect(lost.subject).toBe("Partial loss claim (parcel delivered open) - parcel 6A12345678901 - order #1042");
    expect(text("missing_item").subject).toMatch(/Partial loss/);
    expect(text("crushed_packaging").body).toContain("damaged packaging");
    expect(buildClaimEmail(sampleCase({ assessment: null }), merchant).body).toContain("reported by the recipient");
  });

  it("prints no amount or date that the model wrote in the item name", () => {
    const base = sampleCase();
    const { body } = buildClaimEmail(
      sampleCase({ assessment: { ...base.assessment!, item: "Ceramic vase worth 120 EUR bought 2026-10-01" } }),
      merchant,
    );
    expect(body).not.toContain("120");
    expect(body).not.toContain("2026-10-01");
    expect(body).toContain("Ceramic vase");
  });

  it("throws without an order or a claim", () => {
    expect(() => buildClaimEmail(sampleCase({ order: null }), merchant)).toThrow();
    expect(() => buildClaimEmail(sampleCase({ claim: null }), merchant)).toThrow();
  });
});

describe("formatting", () => {
  it("formats money the English way", () => {
    expect(formatMoney(1240.5)).toBe("€1,240.50");
    expect(formatMoney(9.2)).toBe("€9.20");
    expect(formatMoney(-3)).toBe("-€3.00");
    expect(formatMoney(25, "USD")).toBe("USD 25.00");
  });

  it("formats dates in Paris time without no-break spaces", () => {
    const text = formatDate("2026-10-30T22:59:00.000Z", true);
    expect(text).toBe("30 October 2026, 23:59 (Paris time)");
    expect(formatDate("2026-10-30T22:59:00.000Z")).toBe("30 October 2026");
    expect(text).not.toMatch(/[  ]/);
  });
});

describe("carrierClaimChannel", () => {
  it("knows where each carrier takes claims, and flags the stale address", () => {
    expect(carrierClaimChannel("mondial_relay").email).toBe("offrestart@mondialrelay.fr");
    expect(carrierClaimChannel("chronopost").email).toBeNull();
    expect(carrierClaimChannel("colissimo").verified).toBe(false);
  });

  it("knows how DHL Paket and GLS take claims: no claims address, and where to go instead", () => {
    const dhl = carrierClaimChannel("dhl_paket");
    expect(dhl).toMatchObject({ label: "DHL Paket", email: null, verified: true });
    expect(dhl.how).toMatch(/Schadensanzeige/);
    const gls = carrierClaimChannel("gls");
    expect(gls).toMatchObject({ label: "GLS Germany", email: null, verified: true });
    expect(gls.how).toMatch(/customer portal/);
  });
});
