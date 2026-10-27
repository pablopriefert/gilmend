import { describe, expect, it } from "vitest";
import { buildClaimEmail, carrierClaimChannel, getMerchant } from "./claim-email";
import { formatDateFr, formatMoney } from "./format";
import { sampleCase } from "./test-helpers";

const merchant = getMerchant({});

describe("buildClaimEmail", () => {
  it("carries the tracking number, the order, the amount and the deadline", () => {
    const { subject, body } = buildClaimEmail(sampleCase(), merchant);
    expect(subject).toBe("Réclamation avarie - colis 6A12345678901 - commande #1042");
    expect(body).toContain("9,20 €");
    expect(body).toContain("30 octobre 2026");
    expect(body).toContain("6A12345678901");
    expect(body).toContain("Madame, Monsieur,");
    expect(body).toContain(merchant.name);
  });

  it("mentions the reserve deadline only when the carrier has one", () => {
    const base = sampleCase();
    expect(buildClaimEmail(base, merchant).body).toContain("Date limite des réserves");
    const without = sampleCase({ claim: { ...base.claim!, reserveDeadline: null } });
    expect(buildClaimEmail(without, merchant).body).not.toContain("réserves");
  });

  it("describes the damage in French from the structured assessment", () => {
    const { body } = buildClaimEmail(sampleCase(), merchant);
    expect(body).toContain("Ceramic vase (produit cassé ou endommagé, produit irrécupérable)");
  });

  it("words the declaration after what happened, not always 'avarie constatée à la livraison'", () => {
    const base = sampleCase();
    const text = (damageType: NonNullable<typeof base.assessment>["damageType"]) =>
      buildClaimEmail(sampleCase({ assessment: { ...base.assessment!, damageType } }), merchant);

    // Found on opening a parcel that looked intact (case 1): not "constatée à la livraison".
    expect(text("broken_product").body).toContain("une avarie constatée à l'ouverture du colis");
    expect(text("broken_product").body).not.toContain("à la livraison.");
    // Delivered open with an article missing (case 4): partial loss, not damage.
    const lost = text("opened_parcel");
    expect(lost.body).toContain("un colis livré ouvert dont un article manque (perte partielle)");
    expect(lost.subject).toBe("Réclamation perte partielle (colis livré ouvert) - colis 6A12345678901 - commande #1042");
    expect(text("missing_item").subject).toMatch(/perte partielle/);
    expect(text("crushed_packaging").body).toContain("emballage endommagé");
    expect(buildClaimEmail(sampleCase({ assessment: null }), merchant).body).toContain("signalée par le destinataire");
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
  it("formats money with a plain space and a decimal comma", () => {
    expect(formatMoney(1240.5)).toBe("1 240,50 €");
    expect(formatMoney(9.2)).toBe("9,20 €");
    expect(formatMoney(25, "USD")).toBe("25,00 USD");
  });

  it("formats dates in Paris time without no-break spaces", () => {
    const text = formatDateFr("2026-10-30T22:59:00.000Z", true);
    expect(text).toBe("30 octobre 2026 à 23:59");
    expect(text).not.toMatch(/[  ]/);
  });
});

describe("carrierClaimChannel", () => {
  it("knows where each carrier takes claims, and flags the stale address", () => {
    expect(carrierClaimChannel("mondial_relay").email).toBe("offrestart@mondialrelay.fr");
    expect(carrierClaimChannel("chronopost").email).toBeNull();
    expect(carrierClaimChannel("colissimo").verified).toBe(false);
  });
});
