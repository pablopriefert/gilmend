import type { Env } from "../config";
import { stripFigures } from "../agent/guardrails";
import type { CaseRecord, CarrierId } from "../types";
import {
  CARRIER_LABELS,
  DAMAGE_TYPE_FR,
  SEVERITY_FR,
  claimKind,
  declaredValue,
  formatDateFr,
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

// From research_notes (22 Oct 2026). None of the three carriers has a public claims API, so
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
};

/** Where to file a claim for this carrier (used by the UI next to the e-mail draft). */
export function carrierClaimChannel(carrier: CarrierId): CarrierChannel {
  return CARRIER_CHANNELS[carrier];
}

export interface ClaimEmail {
  subject: string;
  body: string;
}

/** The ready-to-send e-mail to the carrier's claims service. French: the carriers are French. */
export function buildClaimEmail(caseRecord: CaseRecord, merchant: Merchant): ClaimEmail {
  const { order, claim, assessment, report } = caseRecord;
  if (!order || !claim) throw new Error("buildClaimEmail needs an order and a claim computation");

  const carrierName = CARRIER_LABELS[order.carrier];
  const kind = claimKind(assessment);
  const subject = `${kind.subjectPrefix} - colis ${order.trackingNumber} - commande ${order.id}`;

  const lines: string[] = [
    "Madame, Monsieur,",
    "",
    `Je vous contacte au nom de ${merchant.name}, expéditeur du colis ci-dessous, pour vous déclarer ${kind.declaration}.`,
    "",
    `- Transporteur : ${carrierName} (${order.service})`,
    `- Numéro de suivi : ${order.trackingNumber}`,
    `- Commande : ${order.id}`,
    `- Poids : ${formatKg(order.weightKg)}`,
    `- Valeur du contenu : ${formatMoney(declaredValue(order), order.currency)}`,
  ];
  if (order.deliveredAt) lines.push(`- Livré le : ${formatDateFr(order.deliveredAt)}`);
  lines.push(`- Dommage signalé le : ${formatDateFr(report.receivedAt)}`);

  if (assessment) {
    // The article name is the model's free text: no amount or date from it goes to the carrier.
    const item = stripFigures(assessment.item) || "article de la commande";
    lines.push(
      "",
      `Dommage constaté : ${item} (${DAMAGE_TYPE_FR[assessment.damageType]}, ${SEVERITY_FR[assessment.severity]}). Les photos jointes montrent l'état du colis et du produit.`,
    );
  }

  lines.push(
    "",
    `Indemnisation demandée : ${formatMoney(claim.maxCompensationEur)}, selon le barème de votre contrat (détail dans le dossier joint).`,
  );
  if (claim.claimDeadline) {
    lines.push(
      `Cette réclamation est adressée dans le délai : la date limite de réclamation est le ${formatDateFr(claim.claimDeadline, true)}.`,
    );
  }
  if (claim.reserveDeadline) {
    lines.push(`Date limite des réserves : ${formatDateFr(claim.reserveDeadline, true)}.`);
  }

  lines.push(
    "",
    "Vous trouverez en pièces jointes le dossier de réclamation (PDF) et les photos. La facture d'achat du contenu suit ou est jointe séparément.",
    "Merci de bien vouloir confirmer la réception de cette réclamation et de me tenir informé de son traitement.",
    "",
    "Cordialement,",
    merchant.name,
    merchant.address,
    merchant.email,
  );

  return { subject, body: lines.join("\n") };
}
