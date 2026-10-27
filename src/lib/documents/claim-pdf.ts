import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { stripFigures } from "../agent/guardrails";
import type { Env } from "../config";
import { loadImage, normaliseImage } from "../evidence/image-io";
import { evidenceForPhotos } from "../evidence/merge";
import { runtimeDir, safeFileStem, toStoredPath } from "../evidence/runtime-dir";
import { getCarrierRules } from "../rules/carriers";
import { persistRuntimeFile } from "../storage/runtime-files";
import type { CarrierId, CaseRecord, ClaimBasis, ClaimDocument, DamageAssessment, Evidence } from "../types";
import { buildClaimEmail, getMerchant } from "./claim-email";
import {
  CARRIER_LABELS,
  DAMAGE_TYPE_LABEL,
  SEVERITY_LABEL,
  claimKind,
  declaredValue,
  engineLabel,
  formatDate,
  formatKg,
  formatMoney,
} from "./format";

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 50;
const BOTTOM = 60; // room for the footer
const CONTENT_WIDTH = PAGE.width - 2 * MARGIN;
const INK = rgb(0.1, 0.12, 0.18);
const MUTED = rgb(0.4, 0.43, 0.5);
const ACCENT = rgb(0.07, 0.25, 0.45);
const RULE = rgb(0.8, 0.83, 0.88);

export interface BuildClaimDocumentOptions {
  env?: Env;
  /** Injected clock so the "prepared on" date is reproducible in tests. */
  now?: Date;
  /** Redirect data/runtime (tests). */
  runtimeDir?: string;
}

// Characters outside the PDF font's WinAnsi set would make pdf-lib throw mid-document.
const REPLACEMENTS: Record<string, string> = {
  " ": " ",
  " ": " ",
  "→": "->",
  "‑": "-",
  "−": "-",
  "≤": "<=",
  "≥": ">=",
};

class Writer {
  page: PDFPage;
  y: number;
  private readonly supported: Set<number>;

  constructor(
    readonly doc: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
    this.supported = new Set(regular.getCharacterSet());
  }

  clean(text: string): string {
    let out = "";
    for (const ch of text) {
      const mapped = REPLACEMENTS[ch] ?? ch;
      for (const piece of mapped) out += this.supported.has(piece.codePointAt(0)!) ? piece : "?";
    }
    return out;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }

  gap(points: number) {
    this.y -= points;
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of this.clean(text).split("\n")) {
      let current = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const attempt = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(attempt, size) <= width) {
          current = attempt;
        } else {
          if (current) lines.push(current);
          // A single token longer than the line (a long URL): hard-split it.
          let rest = word;
          while (font.widthOfTextAtSize(rest, size) > width) {
            let cut = rest.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
            lines.push(rest.slice(0, cut));
            rest = rest.slice(cut);
          }
          current = rest;
        }
      }
      lines.push(current);
    }
    return lines;
  }

  text(
    text: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number } = {},
  ) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.regular;
    const x = opts.x ?? MARGIN;
    const width = opts.width ?? MARGIN + CONTENT_WIDTH - x;
    const lineHeight = size * 1.3;
    for (const line of this.wrap(text, font, size, width)) {
      this.ensure(lineHeight);
      this.y -= lineHeight;
      if (line) this.page.drawText(line, { x, y: this.y, size, font, color: opts.color ?? INK });
    }
  }

  heading(title: string) {
    this.ensure(40);
    this.gap(10);
    this.text(title.toUpperCase(), { size: 9, bold: true, color: ACCENT });
    this.gap(2);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + CONTENT_WIDTH, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.gap(4);
  }

  /** "Label    value" row; the value wraps inside its own column. */
  row(label: string, value: string) {
    const labelWidth = 150;
    const size = 9.5;
    const lineHeight = size * 1.3;
    const lines = this.wrap(value, this.regular, size, CONTENT_WIDTH - labelWidth);
    // A long label (an order line title) wraps inside its own column instead of running into
    // the value (the "Stoneware espresso cups, set of 4" row of case 4 did).
    const labelLines = this.wrap(label, this.bold, size, labelWidth - 12);
    const count = Math.max(1, lines.length, labelLines.length);
    this.ensure(lineHeight * count);
    const top = this.y - lineHeight;
    labelLines.forEach((line, index) => {
      if (line) this.page.drawText(line, { x: MARGIN, y: top - index * lineHeight, size, font: this.bold, color: MUTED });
    });
    lines.forEach((line, index) => {
      if (line) this.page.drawText(line, { x: MARGIN + labelWidth, y: top - index * lineHeight, size, font: this.regular, color: INK });
    });
    this.y = top - (count - 1) * lineHeight;
  }

  bullet(text: string) {
    this.text(`- ${text}`, { x: MARGIN + 8, width: CONTENT_WIDTH - 8 });
  }
}

interface RulesSummary {
  line: string;
  sources: string[];
}

/**
 * Contract summary for the "compensation basis" section. Built defensively: the rules live
 * in another module that evolves on its own, and a PDF without this block is still correct
 * (it keeps the computed amount and the reasons), whereas a thrown error loses the claim.
 */
function summariseRules(carrier: CarrierId): RulesSummary | null {
  try {
    const rules = getCarrierRules(carrier);
    const { perKgEur, flatEur, capEur } = rules.compensation;
    const parts: string[] = [];
    if (typeof flatEur === "number") parts.push(`flat rate of ${formatMoney(flatEur)} per parcel`);
    if (typeof perKgEur === "number") parts.push(`${formatMoney(perKgEur)} per kg`);
    if (typeof capEur === "number") parts.push(`cap of ${formatMoney(capEur)} per parcel`);
    return {
      line: `${rules.label}: ${parts.join(", ")}.`,
      sources: (rules.sources ?? []).map((s) => `${s.title} (${s.url}, checked on ${s.checkedOn})`),
    };
  } catch {
    return null;
  }
}

/** Embed a photo as JPEG; null when it cannot be read (the PDF says so instead of failing). */
async function embedPhoto(doc: PDFDocument, ref: string, runtime: string) {
  try {
    const loaded = await loadImage(ref, { allowedRoots: [runtime] });
    try {
      const image = await normaliseImage(loaded.bytes, 1400);
      return await doc.embedJpg(image.jpeg);
    } catch {
      // sharp unavailable or format unknown: embed the raw bytes when they are JPEG or PNG.
      const b = loaded.bytes;
      if (b[0] === 0xff && b[1] === 0xd8) return await doc.embedJpg(b);
      if (b[0] === 0x89 && b[1] === 0x50) return await doc.embedPng(b);
      return null;
    }
  } catch {
    return null;
  }
}

/** Every photo of the report, annotated when the agent outlined it (see evidenceForPhotos). */
function photoSources(caseRecord: CaseRecord): Evidence[] {
  return evidenceForPhotos(caseRecord.report.photos, caseRecord.evidence);
}

/**
 * The compensation basis, written from the structured figures of computeClaim (the
 * terms really applied, the weight, the amounts), not copied from its English `reasons`.
 * Those reasons also hold the merchant-only warnings ("the carrier may refuse...") and must
 * never reach the carrier. The old summary also described the BASE grid: for Colissimo with
 * signature it printed 23 EUR per kg while the computation applied 33 EUR per kg.
 */
export function compensationBasisLines(basis: ClaimBasis): string[] {
  const lines = [
    `Terms applied: ${basis.termsLabel}.`,
    `Item concerned: ${basis.itemTitle}, value ${formatMoney(basis.itemValueEur)}.`,
  ];
  const caps: string[] = [`item value ${formatMoney(basis.itemValueEur)}`];
  if (typeof basis.perKgEur === "number") {
    const byWeight = basis.perKgEur * basis.weightKg;
    lines.push(
      `Weight rate: ${formatMoney(basis.perKgEur)} per kg x ${formatKg(basis.weightKg)} = ${formatMoney(byWeight)}.`,
    );
    caps.push(`weight rate ${formatMoney(byWeight)}`);
  }
  if (typeof basis.flatEur === "number") {
    lines.push(`Flat rate: ${formatMoney(basis.flatEur)} per parcel.`);
    caps.push(`flat rate ${formatMoney(basis.flatEur)}`);
  }
  lines.push(`Cap: ${formatMoney(basis.capEur)} per parcel.`);
  caps.push(`cap ${formatMoney(basis.capEur)}`);
  lines.push(`The maximum compensation is the lowest of these amounts: ${caps.join(", ")}.`);
  return lines;
}

/** Words a note uses when it talks about the packing, which the carrier may refuse a claim on. */
const PACKAGING_NOTE = /packag|padding|cushion|wrap|insufficient|inadequate|weak/i;

/**
 * The model's evidence notes that may go into the carrier file. When it read the packaging as
 * inadequate, the claim is kept and only the merchant is warned (guardrails.ts); but the notes are free
 * text, and on a recorded run one said the padding looked thin: printed under "Observations from the
 * photos" it would hand the carrier the very ground the merchant-only warning says it may refuse on
 * (review of 27 Oct 2026). So those notes are dropped, the rest stays.
 */
function carrierFacingNotes(assessment: DamageAssessment): string[] {
  if (assessment.packagingAdequate !== false) return assessment.evidenceNotes;
  return assessment.evidenceNotes.filter((note) => !PACKAGING_NOTE.test(note));
}

/**
 * Build the carrier claim PDF (pdf-lib) and the ready-to-send e-mail, and save the PDF
 * under data/runtime/claims/<caseId>.pdf. The amount and the deadlines are printed from the
 * ClaimComputation (deterministic code), never from a model. It refuses a case without an
 * order or an eligible claim: such a case has nothing to claim, and a PDF would mislead.
 */
export async function buildClaimDocument(
  caseRecord: CaseRecord,
  options: BuildClaimDocumentOptions = {},
): Promise<ClaimDocument> {
  const { order, claim, assessment, report } = caseRecord;
  if (!order) throw new Error("Cannot build a claim document: the case has no order.");
  if (!claim) throw new Error("Cannot build a claim document: the case has no claim computation.");
  if (!claim.eligible) {
    throw new Error("Cannot build a claim document: the claim is not eligible for this carrier.");
  }

  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const merchant = getMerchant(env);
  const runtime = runtimeDir(options.runtimeDir);
  const rules = summariseRules(order.carrier);

  const doc = await PDFDocument.create();
  doc.setTitle(`Carrier claim file - parcel ${order.trackingNumber}`);
  doc.setProducer("Damage Desk (pdf-lib)");
  doc.setCreator("Damage Desk");
  doc.setCreationDate(now);
  const w = new Writer(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
  );

  // Title block
  w.text("Carrier claim file", { size: 19, bold: true, color: ACCENT });
  w.text(claimKind(assessment).label, { size: 10, color: MUTED });
  w.text(`File ${caseRecord.id}  |  prepared on ${formatDate(now.toISOString())}`, {
    size: 9,
    color: MUTED,
  });

  w.heading("Claimant (sender)");
  w.row("Company", merchant.name);
  w.row("Address", merchant.address);
  w.row("E-mail", merchant.email);

  w.heading("Carrier and shipment");
  w.row("Carrier", CARRIER_LABELS[order.carrier]);
  w.row("Service", order.service);
  w.row("Tracking number", order.trackingNumber);
  w.row("Order", order.id);
  w.row("Order date", formatDate(order.createdAt));
  w.row("Delivery", order.deliveredAt ? formatDate(order.deliveredAt) : "not delivered");
  w.row("Recipient", `${order.name}, ${order.shippingAddress.city} (${order.shippingAddress.country})`);
  w.row("Weight", formatKg(order.weightKg));
  w.row("Value of the contents", formatMoney(declaredValue(order), order.currency));
  for (const line of order.lineItems) {
    w.row(
      line.quantity > 1 ? `  ${line.quantity} x ${line.title}` : `  ${line.title}`,
      `${formatMoney(line.unitPrice * line.quantity, order.currency)}  (SKU ${line.sku})`,
    );
  }

  w.heading("Description of the damage");
  w.row("Reported on", formatDate(report.receivedAt));
  if (assessment) {
    // Free text of the model: amounts and dates are removed, they come from computeClaim only.
    w.row("Item concerned", stripFigures(assessment.item) || "see the order");
    w.row("Type", DAMAGE_TYPE_LABEL[assessment.damageType]);
    w.row("Severity", SEVERITY_LABEL[assessment.severity]);
    // The model's reading of the packaging is a merchant-side opinion: when it says "inadequate"
    // the merchant is warned and checks the packing (guardrails.ts), and the carrier file states
    // nothing about it rather than quoting an uncertain reading against the merchant's own claim.
    if (assessment.packagingAdequate !== false) {
      w.row(
        "Packaging",
        assessment.packagingAdequate === null ? "cannot be assessed from the photos" : "suited to the contents",
      );
    }
    const notes = carrierFacingNotes(assessment)
      .map((note) => stripFigures(note))
      .filter(Boolean);
    if (notes.length > 0) {
      w.gap(2);
      w.text("Observations from the photos:", { bold: true, color: MUTED });
      for (const note of notes) w.bullet(note);
    }
  } else {
    w.text("No photo assessment is available for this file.", { color: MUTED });
  }

  w.heading("Compensation basis");
  if (claim.basis) {
    for (const line of compensationBasisLines(claim.basis)) w.bullet(line);
  } else if (rules) {
    // No structured basis (a case computed by an older version): the grid, nothing else.
    w.text(rules.line);
  }
  w.gap(6);
  w.ensure(30);
  w.text(`Maximum compensation claimed: ${formatMoney(claim.maxCompensationEur)}`, {
    size: 13,
    bold: true,
    color: ACCENT,
  });
  if (rules && rules.sources.length > 0) {
    w.gap(2);
    w.text(`Sources: ${rules.sources.join("; ")}`, { size: 7, color: MUTED });
  }

  w.heading("Deadlines");
  if (claim.reserveDeadline) w.row("Reserve deadline", formatDate(claim.reserveDeadline, true));
  if (claim.claimDeadline) {
    w.row(
      "Claim deadline",
      `${formatDate(claim.claimDeadline, true)}${claim.daysLeft !== null ? `  (${claim.daysLeft} day${claim.daysLeft === 1 ? "" : "s"} left)` : ""}`,
    );
  }

  w.heading("Attachments");
  const sources = photoSources(caseRecord);
  w.bullet(`Photos of the parcel and the product: ${sources.length}`);
  w.bullet("Purchase invoice of the contents: to be attached by the merchant (not included in this file)");

  // The signature block stays in one piece: its heading used to be left alone at the bottom
  // of a page while the line to sign went to the next one.
  w.ensure(150);
  w.heading("Signature");
  w.gap(4);
  w.text("Signed at ______________________, on ____ / ____ / ________", { size: 10 });
  w.gap(12);
  w.text("Merchant's signature and stamp:", { color: MUTED });
  w.gap(22);
  w.page.drawLine({
    start: { x: MARGIN, y: w.y },
    end: { x: MARGIN + 220, y: w.y },
    thickness: 0.7,
    color: INK,
  });

  // Photos on their own page(s): evidence is what the carrier actually looks at.
  if (sources.length > 0) {
    w.ensure(260);
    w.gap(10);
    w.text("Photographs", { size: 13, bold: true, color: ACCENT });
    w.gap(6);
    const captionFont = await doc.embedFont(StandardFonts.Helvetica);
    const cellWidth = (CONTENT_WIDTH - 20) / 2;
    const cellHeight = 200;
    let column = 0;
    for (let index = 0; index < sources.length; index++) {
      const item = sources[index]!;
      // Prefer the annotated photo; fall back to the raw one if it cannot be read.
      let image = item.annotatedPhoto ? await embedPhoto(doc, item.annotatedPhoto, runtime) : null;
      const annotated = image !== null;
      if (!image) image = await embedPhoto(doc, item.photo, runtime);

      if (column === 0) w.ensure(cellHeight + 40);
      const x = MARGIN + column * (cellWidth + 20);
      const caption = !image
        ? `Photo ${index + 1}: image not available`
        : annotated
          ? `Photo ${index + 1}: outlined by SAM 3.1 (the item or its pieces, not a damage verdict)`
          : `Photo ${index + 1}: original photo`;
      let drawnHeight = 0;
      if (image) {
        const scale = Math.min(cellWidth / image.width, cellHeight / image.height);
        const width = image.width * scale;
        drawnHeight = image.height * scale;
        w.page.drawImage(image, { x, y: w.y - drawnHeight, width, height: drawnHeight });
      }
      // Caption right under the picture, not at a fixed offset, so a landscape photo
      // does not leave a gap.
      w.page.drawText(w.clean(caption), {
        x,
        y: w.y - (image ? drawnHeight : 10) - 12,
        size: 8,
        font: captionFont,
        color: MUTED,
      });
      column += 1;
      if (column === 2 || index === sources.length - 1) {
        column = 0;
        w.y -= cellHeight + 34;
      }
    }
  }

  // Footer on every page, added last so the page count is known.
  const footerFont = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const footer = w.clean(
      `Damage Desk  |  file ${caseRecord.id}  |  engine: ${engineLabel(caseRecord.engine, caseRecord.engineDetail)}  |  page ${index + 1}/${pages.length}`,
    );
    page.drawText(footer, { x: MARGIN, y: 30, size: 7.5, font: footerFont, color: MUTED });
  });

  const dir = path.join(runtime, "claims");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safeFileStem(caseRecord.id)}.pdf`);
  await writeFile(file, await doc.save());
  // Copy to the shared store when one is configured (no-op otherwise): the PDF route of
  // another serverless instance reads it from there.
  await persistRuntimeFile(file, runtime);

  const email = buildClaimEmail(caseRecord, merchant);
  return { pdfPath: toStoredPath(file), emailSubject: email.subject, emailBody: email.body };
}
