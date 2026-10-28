import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "../documents/test-helpers";
import { buildClaimEmail } from "../documents/claim-email";
import { loadDemoCases } from "../store/demo-cases";
import { resolveDemoPhoto } from "../store/demo-photos";
import { detectLanguage } from "../../app/api/_lib/language";
import { runAgent } from "./run-agent";

// The Europe lot's demo case (data/demo-cases.json, "demo-7-german-carafe"): a German customer writes in
// German about a DHL Paket parcel within Germany. Real orders, rules, integrity check and PDF modules,
// the demo-mock engine (no key, no network); only mark_damage is faked. What this proves is that the
// loop, the rules and the documents hold for a second country, not that Muse reads German well: that
// needs a real run (npm run real -- demo-7-german-carafe), which this test never makes.

beforeAll(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const NOW = new Date("2026-10-28T12:00:00.000Z");
const demo = loadDemoCases(NOW).find((d) => d.id === "demo-7-german-carafe")!;

async function runGerman() {
  // The case names its photo "<name>.jpg" (the photo the team will shoot); the stand-in is a .webp.
  // The demo script resolves it the same way, and the integrity check needs a file it can read.
  const photos = demo.report.photos.map((p) => resolveDemoPhoto(p) ?? p);
  return runAgent({ ...demo.report, photos }, {
    engine: "demo-mock",
    env: {},
    now: NOW,
    deps: { markDamage: async (photo) => ({ photo, annotatedPhoto: null, method: "none", note: "faked in test" }) },
  });
}

describe("the German demo case, demo-mock engine, real modules", () => {
  it("is a German message about a German order", () => {
    expect(demo.report.language).toBe("de");
    expect(demo.report.message).toMatch(/Guten Tag/);
    expect(demo.report.orderNumber).toBe("#1011");
    // The case sets German itself; the rationale also says Auto-detect finds it, so keep that true.
    expect(detectLanguage(demo.report.message)).toBe("de");
  });

  it("reships and claims DHL Paket, with the item value as the ceiling", async () => {
    const c = await runGerman();
    expect(c.order).toMatchObject({ id: "#1011", carrier: "dhl_paket", shippingAddress: { country: "DE" } });
    expect(c.decision).toMatchObject({ decision: "reship", carrierClaim: true, needsHuman: false });
    expect(c.claim).toMatchObject({ eligible: true, maxCompensationEur: 54 });
    expect(c.claim?.basis).toMatchObject({ termsLabel: "DHL Paket (Germany, standard terms)", flatEur: 500, flatKind: "limit", capEur: 500 });
    // Delivered 18 h before NOW: the claim stays open for one year after delivery (HGB § 439), so 365 days minus
    // 18 h are left, rounded down to 364. (The 7 days are the report window, which only warns.)
    expect(c.claim?.daysLeft).toBe(364);
    expect(demo.expected).toMatchObject({ decision: "reship", carrierClaim: true, claimEligible: true });
  });

  it("writes the customer reply in German", async () => {
    const c = await runGerman();
    expect(c.report.language).toBe("de");
    expect(c.decision?.customerReply).toMatch(/^Hallo Jonas,/);
    expect(c.decision?.customerReply).toMatch(/Mit freundlichen Grüßen/);
    expect(c.decision?.customerReply).not.toMatch(/\bThank you\b/);
  });

  it("does not flag the reused carafe photo, because it is this case's own demo photo", async () => {
    const c = await runGerman();
    expect(c.integrity?.signals).toEqual([]);
    expect(c.integrity?.photos[0].matches.length).toBeGreaterThan(0);
    // Every match of the photo is the German case itself: the late-report case that shares the picture
    // is not shown as "another customer".
    expect(c.integrity?.photos[0].matches.every((m) => m.sameOrderAndCustomer)).toBe(true);
    expect(c.integrity?.comparedDemoPhotos).toBe(6);
  });

  it("builds a claim file and an e-mail for DHL that stay in English, with the DHL label", async () => {
    const c = await runGerman();
    expect(c.document).not.toBeNull();
    const mail = buildClaimEmail(c, { name: "Maison Démo", address: "12 rue de la Démo, 75011 Paris, France", email: "contact@demo.example" });
    expect(mail.subject).toMatch(/parcel 00340434990010110017 - order #1011/);
    // The service is not repeated when it only says the carrier's own name again.
    expect(mail.body).toMatch(/^- Carrier: DHL Paket$/m);
    expect(mail.body).not.toMatch(/DHL Paket \(DHL Paket\)/);
    expect(mail.body).toMatch(/Compensation claimed: €54\.00/);
    // Nothing of the German customer's message goes to the carrier.
    expect(mail.body).not.toMatch(/Karaffe|Riss|Guten Tag/);
  });

  it("prints the DHL terms, their sources and their check date on the claim PDF, in English", async () => {
    const c = await runGerman();
    const text = extractPdfText(await readFile(path.resolve(c.document!.pdfPath)));
    expect(text).toContain("00340434990010110017");
    expect(text).toContain("Terms applied: DHL Paket (Germany, standard terms).");
    // DHL clause 6(3) is a ceiling, not a fixed payment: the file must not call it a flat rate.
    expect(text).toContain("Liability limit: €500.00 per parcel.");
    expect(text).not.toMatch(/Flat rate|flat rate/);
    expect(text).toContain("€54.00");
    expect(text).toContain("gesetze-im-internet.de");
    expect(text).toContain("checked on 2026-10-28");
    // The PDF stays English: nothing of the German message, and no merchant-only warning.
    expect(text).not.toMatch(/Karaffe|Guten Tag/);
    expect(text).not.toMatch(/Warning:/);
  });
});
