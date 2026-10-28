import type { Env } from "../config";
import { stripFigures } from "../agent/guardrails";
import type { CaseRecord, CarrierId } from "../types";
import {
  CARRIER_LABELS,
  DAMAGE_TYPE_LABEL,
  SEVERITY_LABEL,
  claimKind,
  declaredValue,
  formatDate,
  formatKg,
  formatMoney,
} from "./format";

// Merchant identity comes from the environment so the demo can be rebranded without code
// changes. The defaults are obviously fictitious and say so.
export interface Merchant {
  name: string;
  address: string;
  email: string;
}

export function getMerchant(env: Env = process.env): Merchant {
  return {
    name: env.MERCHANT_NAME?.trim() || "Maison Demo (demo merchant)",
    address: env.MERCHANT_ADDRESS?.trim() || "12 rue de la Démo, 75011 Paris, France",
    email: env.MERCHANT_EMAIL?.trim() || "claims@maison-demo.example",
  };
}

export interface CarrierChannel {
  label: string;
  /** Claims mailbox when the carrier accepts one; null when only a web form exists. */
  email: string | null;
  /** How the merchant files the claim. */
  how: string;
  /** False when the address comes from an old public source and must be re-checked. */
  verified: boolean;
}

// From research_notes (22 Oct 2026) for the three French carriers, and from the carriers' own pages
// read on 28 Oct 2026 for DHL Paket and GLS. None of them has a public claims API, so
// the agent prepares the file and the merchant files it: nothing is sent without a click.
export const CARRIER_CHANNELS: Record<CarrierId, CarrierChannel> = {
  colissimo: {
    label: CARRIER_LABELS.colissimo,
    email: "scsmb.clp@laposte.fr",
    how: "Outil de Suivi Colis (Colissimo Box); e-mail only for reasons not listed there.",
    // The address is from the 2021 CGV; the 2026 CGV are not public.
    verified: false,
  },
  mondial_relay: {
    label: CARRIER_LABELS.mondial_relay,
    email: "offrestart@mondialrelay.fr",
    how: "Connect, or e-mail with the parcel number (Offre Start).",
    verified: true,
  },
  chronopost: {
    label: CARRIER_LABELS.chronopost,
    email: null,
    how: "Online form or live chat in the customer area; no claims e-mail is published.",
    verified: true,
  },
  dhl_paket: {
    label: CARRIER_LABELS.dhl_paket,
    email: null,
    how: "DHL Schadensanzeige form with the damaged parcel and all its parts, handed in at a DHL branch or collected (DHL's help page for recipients; check the procedure of your own contract). No claims e-mail is published.",
    verified: true,
  },
  gls: {
    label: CARRIER_LABELS.gls,
    email: null,
    how: "GLS business contact form, or the customer portal under \"Paketschäden\" (GLS's FAQ for business shippers). No claims e-mail is published.",
    verified: true,
  },
};

/** Where to file a claim for this carrier (used by the UI next to the e-mail draft). */
export function carrierClaimChannel(carrier: CarrierId): CarrierChannel {
  return CARRIER_CHANNELS[carrier];
}

export interface ClaimEmail {
  subject: string;
  body: string;
}

/** The ready-to-send e-mail to the carrier's claims service, in English like the rest of the product. */
export function buildClaimEmail(caseRecord: CaseRecord, merchant: Merchant): ClaimEmail {
  const { order, claim, assessment, report } = caseRecord;
  if (!order || !claim) throw new Error("buildClaimEmail needs an order and a claim computation");

  const carrierName = CARRIER_LABELS[order.carrier];
  // "DHL Paket (DHL Paket)" looks careless in a document meant for the carrier: the service is added
  // only when it says something the label does not.
  const service = order.service?.trim() ?? "";
  const carrierLine = service && service.toLowerCase() !== carrierName.toLowerCase() ? `${carrierName} (${service})` : carrierName;
  const kind = claimKind(assessment);
  const subject = `${kind.subjectPrefix} - parcel ${order.trackingNumber} - order ${order.id}`;

  const lines: string[] = [
    "Dear Sir or Madam,",
    "",
    `I am writing on behalf of ${merchant.name}, sender of the parcel below, to report ${kind.declaration}.`,
    "",
    `- Carrier: ${carrierLine}`,
    `- Tracking number: ${order.trackingNumber}`,
    `- Order: ${order.id}`,
    `- Weight: ${formatKg(order.weightKg)}`,
    `- Value of the contents: ${formatMoney(declaredValue(order), order.currency)}`,
  ];
  if (order.deliveredAt) lines.push(`- Delivered on: ${formatDate(order.deliveredAt)}`);
  lines.push(`- Damage reported on: ${formatDate(report.receivedAt)}`);

  if (assessment) {
    // The article name is the model's free text: no amount or date from it goes to the carrier.
    const item = stripFigures(assessment.item) || "item of the order";
    lines.push(
      "",
      `Damage found: ${item} (${DAMAGE_TYPE_LABEL[assessment.damageType]}, ${SEVERITY_LABEL[assessment.severity]}). The attached photos show the state of the parcel and of the product.`,
    );
  }

  lines.push(
    "",
    `Compensation claimed: ${formatMoney(claim.maxCompensationEur)}, under the terms of your contract (details in the attached claim file).`,
  );
  if (claim.claimDeadline) {
    lines.push(`This claim is filed in time: the claim deadline is ${formatDate(claim.claimDeadline, true)}.`);
  }
  if (claim.reserveDeadline) {
    lines.push(`Reserve deadline: ${formatDate(claim.reserveDeadline, true)}.`);
  }

  lines.push(
    "",
    "Please find attached the claim file (PDF) and the photos. The purchase invoice of the contents follows or is attached separately.",
    "Please confirm receipt of this claim and keep me informed of its progress.",
    "",
    "Kind regards,",
    merchant.name,
    merchant.address,
    merchant.email,
  );

  return { subject, body: lines.join("\n") };
}
