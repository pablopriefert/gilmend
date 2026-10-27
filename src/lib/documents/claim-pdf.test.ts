import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildClaimDocument } from "./claim-pdf";
import { extractPdfText, sampleCase } from "./test-helpers";

const NOW = new Date("2026-10-27T10:00:00.000Z");
let dir: string;
let photoPath: string;
let annotatedPath: string;
let secondPath: string;
let thirdPath: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "damage-desk-pdf-"));
  photoPath = path.join(dir, "photo.jpg");
  annotatedPath = path.join(dir, "annotated.jpg");
  const make = (color: string) =>
    sharp({ create: { width: 640, height: 480, channels: 3, background: color } }).jpeg().toBuffer();
  await writeFile(photoPath, await make("#8899aa"));
  await writeFile(annotatedPath, await make("#cc3344"));
  secondPath = path.join(dir, "second.jpg");
  thirdPath = path.join(dir, "third.jpg");
  await writeFile(secondPath, await make("#44aa66"));
  await writeFile(thirdPath, await make("#aa8844"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const build = (overrides = {}, env: Record<string, string> = {}) =>
  buildClaimDocument(sampleCase(overrides), { runtimeDir: dir, now: NOW, env });

describe("buildClaimDocument", () => {
  it("writes a PDF under claims/<caseId>.pdf that holds the tracking number and the amount", async () => {
    const result = await build();
    expect(result.pdfPath.endsWith(path.join("claims", "case-1042.pdf"))).toBe(true);
    const bytes = await readFile(path.resolve(result.pdfPath));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

    const text = extractPdfText(bytes);
    expect(text).toContain("6A12345678901");
    expect(text).toContain("9,20 €");
    expect(text).toContain("#1042");
    expect(text).toContain("Ceramic vase");
    expect(text).toContain("Signature");
  });

  it("writes the basis in French from the applied terms, with no English or merchant-only warning", async () => {
    const base = sampleCase();
    const text = extractPdfText(
      await readFile(
        path.resolve(
          (
            await build({
              id: "case-basis",
              claim: {
                ...base.claim!,
                maxCompensationEur: 75.9,
                reasons: [
                  "Maximum compensation: min(item value 45.00 EUR) = 45.00 EUR.",
                  "Warning: the photos do not show whether the packaging was adequate; the carrier may refuse compensation.",
                  "Warning: Mondial Relay only accepts claims when the recipient refused the damaged parcel; confirm this with the customer before filing.",
                  "Note: the final indemnity may be lower than this ceiling.",
                ],
                basis: {
                  termsLabel: "Colissimo Domicile avec signature",
                  itemTitle: "Ceramic vase",
                  itemValueEur: 120,
                  weightKg: 2.3,
                  perKgEur: 33,
                  capEur: 990,
                },
              },
            })
          ).pdfPath,
        ),
      ),
    );
    expect(text).toContain("Conditions appliquées : Colissimo Domicile avec signature.");
    // The applied variant (33 EUR/kg, 990 EUR cap), not the base grid (23 EUR/kg, 690 EUR cap).
    expect(text).toContain("Barème au poids : 33,00 € par kg x 2,3 kg = 75,90 €.");
    expect(text).toContain("Plafond : 990,00 € par colis.");
    expect(text).not.toContain("690,00");
    expect(text).toContain("plus bas de ces montants");
    // Nothing that helps the carrier refuse, nothing in English copied from computeClaim.
    expect(text).not.toMatch(/Warning|Note:|may refuse|confirm this with the customer|may be lower|Maximum compensation/);
  });

  it("describes a partial loss as such in the subtitle", async () => {
    const base = sampleCase();
    const text = extractPdfText(
      await readFile(
        path.resolve(
          (await build({ id: "case-loss", assessment: { ...base.assessment!, damageType: "opened_parcel" } })).pdfPath,
        ),
      ),
    );
    expect(text).toContain("Perte partielle (colis livré ouvert)");
  });

  it("prints no figure the model wrote in the photo reading (item, observations)", async () => {
    const base = sampleCase();
    const text = extractPdfText(
      await readFile(
        path.resolve(
          (
            await build({
              id: "case-figures",
              assessment: {
                ...base.assessment!,
                item: "Vase worth 999 EUR",
                evidenceNotes: ["Replacement cost about €120", "Vase split into three pieces"],
              },
            })
          ).pdfPath,
        ),
      ),
    );
    expect(text).not.toContain("999");
    expect(text).not.toContain("120");
    expect(text).toContain("Vase split into three pieces");
  });

  it("stays within one or two pages without photos", async () => {
    const result = await build();
    const pdf = await PDFDocument.load(await readFile(path.resolve(result.pdfPath)));
    expect(pdf.getPageCount()).toBeLessThanOrEqual(2);
  });

  it("prints the deadlines from the claim computation, in Paris time", async () => {
    const text = extractPdfText(await readFile(path.resolve((await build()).pdfPath)));
    expect(text).toContain("30 octobre 2026");
    expect(text).toContain("29 octobre 2026");
    expect(text).toContain("3 jours restants");
  });

  it("uses the merchant identity from the environment, with demo defaults otherwise", async () => {
    const custom = await build(
      {},
      { MERCHANT_NAME: "Atelier Lumière", MERCHANT_ADDRESS: "5 rue Verte, 69002 Lyon", MERCHANT_EMAIL: "sav@atelier.example" },
    );
    const customText = extractPdfText(await readFile(path.resolve(custom.pdfPath)));
    expect(customText).toContain("Atelier Lumière");
    expect(customText).toContain("sav@atelier.example");

    const demoText = extractPdfText(await readFile(path.resolve((await build()).pdfPath)));
    expect(demoText).toContain("Maison Demo (demo merchant)");
  });

  it("labels a mock run in the footer so it never passes for Muse", async () => {
    const mock = extractPdfText(await readFile(path.resolve((await build({ engine: "demo-mock" })).pdfPath)));
    expect(mock).toContain("DEMO MODE, not Muse");
    const muse = extractPdfText(await readFile(path.resolve((await build({ engine: "muse-spark-1.3" })).pdfPath)));
    expect(muse).toContain("Muse Spark 1.3");
    expect(muse).not.toContain("DEMO MODE");
  });

  it("embeds the annotated photo when there is one and the raw photo otherwise", async () => {
    const base = sampleCase();
    const withPhotos = sampleCase({
      id: "case-photos",
      evidence: [
        { photo: photoPath, annotatedPhoto: annotatedPath, method: "sam-3.1", note: "" },
        { photo: secondPath, annotatedPhoto: null, method: "none", note: "" },
      ],
      report: { ...base.report, photos: [photoPath, secondPath] },
    });
    const result = await buildClaimDocument(withPhotos, { runtimeDir: dir, now: NOW, env: {} });
    const bytes = await readFile(path.resolve(result.pdfPath));
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeLessThanOrEqual(2);
    expect(Buffer.from(bytes).toString("latin1").match(/\/Subtype\s*\/Image/g)?.length).toBe(2);
    const text = extractPdfText(bytes);
    expect(text).toContain("zone du dommage entourée (SAM 3.1)");
    expect(text).toContain("photo d'origine");
  });

  it("keeps every photo of the report when only one of them was outlined", async () => {
    // The agent may call mark_damage on the most telling photo only: the carton and the
    // padding photos are documents the carrier asks for and must stay in the claim.
    const base = sampleCase();
    const result = await buildClaimDocument(
      sampleCase({
        id: "case-three-photos",
        evidence: [{ photo: photoPath, annotatedPhoto: annotatedPath, method: "sam-3.1", note: "" }],
        report: { ...base.report, photos: [photoPath, secondPath, thirdPath] },
      }),
      { runtimeDir: dir, now: NOW, env: {} },
    );
    const bytes = await readFile(path.resolve(result.pdfPath));
    expect(Buffer.from(bytes).toString("latin1").match(/\/Subtype\s*\/Image/g)?.length).toBe(3);
    const text = extractPdfText(bytes);
    expect(text).toContain("Photo 1 : zone du dommage entourée (SAM 3.1)");
    expect(text).toContain("Photo 2 : photo d'origine");
    expect(text).toContain("Photo 3 : photo d'origine");
    expect(text).toContain("Photos du colis et du produit : 3");
  });

  it("falls back to the report photos when no evidence was produced", async () => {
    const base = sampleCase();
    const result = await buildClaimDocument(
      sampleCase({ id: "case-raw", report: { ...base.report, photos: [photoPath] } }),
      { runtimeDir: dir, now: NOW, env: {} },
    );
    const bytes = await readFile(path.resolve(result.pdfPath));
    expect(Buffer.from(bytes).toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
  });

  it("does not fail when a photo cannot be read: the PDF says so", async () => {
    const result = await buildClaimDocument(
      sampleCase({
        id: "case-missing",
        report: { ...sampleCase().report, photos: [path.join(dir, "gone.jpg")] },
      }),
      { runtimeDir: dir, now: NOW, env: {} },
    );
    expect(extractPdfText(await readFile(path.resolve(result.pdfPath)))).toContain("image non disponible");
  });

  it("survives characters the PDF font cannot draw", async () => {
    const base = sampleCase();
    const result = await buildClaimDocument(
      sampleCase({
        id: "case-chars",
        assessment: { ...base.assessment!, item: "Vase 🏺 → fragile", evidenceNotes: ["Crack ≥ 3 cm"] },
      }),
      { runtimeDir: dir, now: NOW, env: {} },
    );
    expect(result.pdfPath).toBeTruthy();
  });

  it("builds without an assessment", async () => {
    const result = await build({ id: "case-noassess", assessment: null });
    expect(extractPdfText(await readFile(path.resolve(result.pdfPath)))).toContain("non disponible");
  });

  it("keeps a hostile case id inside the claims folder", async () => {
    const result = await build({ id: "../../evil" });
    const resolved = path.resolve(result.pdfPath);
    expect(resolved.startsWith(path.join(dir, "claims") + path.sep)).toBe(true);
    await expect(stat(resolved)).resolves.toBeTruthy();
  });

  it("refuses a case that has nothing to claim", async () => {
    await expect(build({ order: null })).rejects.toThrow(/no order/);
    await expect(build({ claim: null })).rejects.toThrow(/no claim computation/);
    const base = sampleCase();
    await expect(build({ claim: { ...base.claim!, eligible: false } })).rejects.toThrow(/not eligible/);
  });

  it("returns the e-mail with the document", async () => {
    const result = await build();
    expect(result.emailSubject).toContain("6A12345678901");
    expect(result.emailBody).toContain("9,20 €");
  });
});
