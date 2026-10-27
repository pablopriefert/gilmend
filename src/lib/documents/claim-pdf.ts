import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { stripFigures } from "../agent/guardrails";
import type { Env } from "../config";
import { loadImage, normaliseImage } from "../evidence/image-io";
import { evidenceForPhotos } from "../evidence/merge";
import { runtimeDir, safeFileStem, toStoredPath } from "../evidence/runtime-dir";
import { getCarrierRules } from "../rules/carriers";
import type { CarrierId, CaseRecord, ClaimBasis, ClaimDocument, Evidence } from "../types";
import { buildClaimEmail, getMerchant } from "./claim-email";
import {
  CARRIER_LABELS,
  DAMAGE_TYPE_FR,
  SEVERITY_FR,
  claimKind,
  declaredValue,
  engineLabel,
  formatDateFr,
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
    if (typeof flatEur === "number") parts.push(`forfait de ${formatMoney(flatEur)} par colis`);
    if (typeof perKgEur === "number") parts.push(`${formatMoney(perKgEur)} par kg`);
    if (typeof capEur === "number") parts.push(`plafond de ${formatMoney(capEur)} par colis`);
    return {
      line: `${rules.label} : ${parts.join(", ")}.`,
      sources: (rules.sources ?? []).map((s) => `${s.title} (${s.url}, vérifié le ${s.checkedOn})`),
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
 * The compensation basis in French, written from the structured figures of computeClaim (the
 * terms really applied, the weight, the amounts), not copied from its English `reasons`.
 * Those reasons also hold the merchant-only warnings ("the carrier may refuse...") and must
 * never reach the carrier. The old summary also described the BASE grid: for Colissimo with
 * signature it printed 23 EUR per kg while the computation applied 33 EUR per kg.
 */
export function compensationBasisLines(basis: ClaimBasis): string[] {
  const lines = [
    `Conditions appliquées : ${basis.termsLabel}.`,
    `Article concerné : ${basis.itemTitle}, valeur ${formatMoney(basis.itemValueEur)}.`,
  ];
  const caps: string[] = [`valeur de l'article ${formatMoney(basis.itemValueEur)}`];
  if (typeof basis.perKgEur === "number") {
    const byWeight = basis.perKgEur * basis.weightKg;
    lines.push(
      `Barème au poids : ${formatMoney(basis.perKgEur)} par kg x ${formatKg(basis.weightKg)} = ${formatMoney(byWeight)}.`,
    );
    caps.push(`barème au poids ${formatMoney(byWeight)}`);
  }
  if (typeof basis.flatEur === "number") {
    lines.push(`Forfait : ${formatMoney(basis.flatEur)} par colis.`);
    caps.push(`forfait ${formatMoney(basis.flatEur)}`);
  }
  lines.push(`Plafond : ${formatMoney(basis.capEur)} par colis.`);
  caps.push(`plafond ${formatMoney(basis.capEur)}`);
  lines.push(`L'indemnité maximale est le plus bas de ces montants : ${caps.join(", ")}.`);
  return lines;
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
  doc.setTitle(`Dossier de réclamation - colis ${order.trackingNumber}`);
  doc.setProducer("Damage Desk (pdf-lib)");
  doc.setCreator("Damage Desk");
  doc.setCreationDate(now);
  const w = new Writer(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
  );

  // Title block
  w.text("Dossier de réclamation transporteur", { size: 19, bold: true, color: ACCENT });
  w.text(`${claimKind(assessment).label}  |  Carrier claim file`, { size: 10, color: MUTED });
  w.text(`Dossier n° ${caseRecord.id}  |  préparé le ${formatDateFr(now.toISOString())}`, {
    size: 9,
    color: MUTED,
  });

  w.heading("Réclamant (expéditeur)");
  w.row("Société", merchant.name);
  w.row("Adresse", merchant.address);
  w.row("E-mail", merchant.email);

  w.heading("Transporteur et envoi");
  w.row("Transporteur", CARRIER_LABELS[order.carrier]);
  w.row("Service", order.service);
  w.row("Numéro de suivi", order.trackingNumber);
  w.row("Commande", order.id);
  w.row("Date de la commande", formatDateFr(order.createdAt));
  w.row("Livraison", order.deliveredAt ? formatDateFr(order.deliveredAt) : "non livré");
  w.row("Destinataire", `${order.name}, ${order.shippingAddress.city} (${order.shippingAddress.country})`);
  w.row("Poids", formatKg(order.weightKg));
  w.row("Valeur du contenu", formatMoney(declaredValue(order), order.currency));
  for (const line of order.lineItems) {
    w.row(
      line.quantity > 1 ? `  ${line.quantity} x ${line.title}` : `  ${line.title}`,
      `${formatMoney(line.unitPrice * line.quantity, order.currency)}  (réf. ${line.sku})`,
    );
  }

  w.heading("Description du dommage");
  w.row("Signalé le", formatDateFr(report.receivedAt));
  if (assessment) {
    // Free text of the model: amounts and dates are removed, they come from computeClaim only.
    w.row("Article concerné", stripFigures(assessment.item) || "voir la commande");
    w.row("Nature", DAMAGE_TYPE_FR[assessment.damageType]);
    w.row("Gravité", SEVERITY_FR[assessment.severity]);
    w.row(
      "Emballage",
      assessment.packagingAdequate === null
        ? "non évaluable sur les photos"
        : assessment.packagingAdequate
          ? "adapté au contenu"
          : "insuffisant (à examiner)",
    );
    if (assessment.evidenceNotes.length > 0) {
      w.gap(2);
      w.text("Observations relevées sur les photos :", { bold: true, color: MUTED });
      for (const note of assessment.evidenceNotes) {
        const cleaned = stripFigures(note);
        if (cleaned) w.bullet(cleaned);
      }
    }
  } else {
    w.text("Analyse des photos non disponible pour ce dossier.", { color: MUTED });
  }

  w.heading("Base de l'indemnisation");
  if (claim.basis) {
    for (const line of compensationBasisLines(claim.basis)) w.bullet(line);
  } else if (rules) {
    // No structured basis (a case computed by an older version): the grid, nothing else.
    w.text(rules.line);
  }
  w.gap(6);
  w.ensure(30);
  w.text(`Indemnisation maximale demandée : ${formatMoney(claim.maxCompensationEur)}`, {
    size: 13,
    bold: true,
    color: ACCENT,
  });
  if (rules && rules.sources.length > 0) {
    w.gap(2);
    w.text(`Sources : ${rules.sources.join(" ; ")}`, { size: 7, color: MUTED });
  }

  w.heading("Délais");
  if (claim.reserveDeadline) w.row("Date limite des réserves", formatDateFr(claim.reserveDeadline, true));
  if (claim.claimDeadline) {
    w.row(
      "Date limite de réclamation",
      `${formatDateFr(claim.claimDeadline, true)}${claim.daysLeft !== null ? `  (${claim.daysLeft} jour${claim.daysLeft > 1 ? "s" : ""} restant${claim.daysLeft > 1 ? "s" : ""})` : ""}`,
    );
  }

  w.heading("Pièces jointes");
  const sources = photoSources(caseRecord);
  w.bullet(`Photos du colis et du produit : ${sources.length}`);
  w.bullet("Facture d'achat du contenu : à joindre par le marchand (non incluse dans ce dossier)");

  // The signature block stays in one piece: its heading used to be left alone at the bottom
  // of a page while the line to sign went to the next one.
  w.ensure(150);
  w.heading("Signature");
  w.gap(4);
  w.text("Fait à ______________________, le ____ / ____ / ________", { size: 10 });
  w.gap(12);
  w.text("Signature et cachet du marchand :", { color: MUTED });
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
    w.text("Photographies", { size: 13, bold: true, color: ACCENT });
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
        ? `Photo ${index + 1} : image non disponible`
        : annotated
          ? `Photo ${index + 1} : zone du dommage entourée (SAM 3.1)`
          : `Photo ${index + 1} : photo d'origine`;
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
      `Damage Desk  |  dossier ${caseRecord.id}  |  moteur : ${engineLabel(caseRecord.engine)}  |  page ${index + 1}/${pages.length}`,
    );
    page.drawText(footer, { x: MARGIN, y: 30, size: 7.5, font: footerFont, color: MUTED });
  });

  const dir = path.join(runtime, "claims");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safeFileStem(caseRecord.id)}.pdf`);
  await writeFile(file, await doc.save());

  const email = buildClaimEmail(caseRecord, merchant);
  return { pdfPath: toStoredPath(file), emailSubject: email.subject, emailBody: email.body };
}
