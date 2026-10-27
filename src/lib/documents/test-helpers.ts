import { inflateSync } from "node:zlib";
import type { CaseRecord, Evidence } from "../types";

// Shared by the document and evidence tests (not imported by app code).

/**
 * Extract the text drawn by a pdf-lib document, without a PDF parsing dependency: inflate
 * every stream and read the `<hex> Tj` operators that pdf-lib writes for standard fonts
 * (WinAnsi bytes). Good enough to assert "the tracking number is in the PDF"; not a general
 * PDF text extractor.
 */
export function extractPdfText(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf).toString("latin1");
  const chunks: string[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let match = streamPattern.exec(raw); match; match = streamPattern.exec(raw)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1]!, "latin1")).toString("latin1");
    } catch {
      continue; // an image or font stream, not page content
    }
    const showText = /<([0-9A-Fa-f]+)>\s*Tj/g;
    const lineParts: string[] = [];
    for (let t = showText.exec(content); t; t = showText.exec(content)) {
      lineParts.push(new TextDecoder("windows-1252").decode(Buffer.from(t[1]!, "hex")));
    }
    chunks.push(lineParts.join("\n"));
  }
  return chunks.join("\n");
}

export function sampleCase(overrides: Partial<CaseRecord> = {}): CaseRecord {
  const evidence: Evidence[] = [];
  return {
    id: "case-1042",
    report: {
      id: "report-1042",
      receivedAt: "2026-10-27T09:30:00.000Z",
      customerEmail: "ada@example.com",
      orderNumber: "#1042",
      message: "My vase arrived broken",
      photos: [],
      language: "en",
    },
    order: {
      id: "#1042",
      name: "Ada Example",
      email: "ada@example.com",
      createdAt: "2026-10-20T08:00:00.000Z",
      deliveredAt: "2026-10-26T14:10:00.000Z",
      carrier: "colissimo",
      service: "Colissimo Domicile sans signature",
      trackingNumber: "6A12345678901",
      weightKg: 0.4,
      currency: "EUR",
      lineItems: [{ sku: "VASE-01", title: "Ceramic vase", quantity: 1, unitPrice: 45 }],
      total: 52.9,
      shippingAddress: { city: "Lyon", country: "FR" },
    },
    assessment: {
      item: "Ceramic vase",
      damageType: "broken_product",
      severity: "total",
      carrierLikelyAtFault: true,
      packagingAdequate: true,
      evidenceNotes: ["Vase split into three pieces", "Outer box dented on one corner"],
      photoQuality: "ok",
    },
    claim: {
      eligible: true,
      reasons: ["Colissimo pays 23 EUR per kg for a parcel of 1 kg or less: 0.4 kg gives 9.20 EUR."],
      maxCompensationEur: 9.2,
      claimDeadline: "2026-10-30T22:59:00.000Z",
      reserveDeadline: "2026-10-29T14:10:00.000Z",
      daysLeft: 3,
      basis: {
        termsLabel: "Colissimo (La Poste)",
        itemTitle: "Ceramic vase",
        itemValueEur: 45,
        weightKg: 0.4,
        perKgEur: 23,
        capEur: 690,
      },
    },
    decision: null,
    evidence,
    document: null,
    status: "needs_review",
    engine: "demo-mock",
    trace: [],
    createdAt: "2026-10-27T09:31:00.000Z",
    updatedAt: "2026-10-27T09:31:00.000Z",
    ...overrides,
  };
}
