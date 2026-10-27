import { loadImage } from "../evidence/image-io";
import type {
  CaseRecord,
  DamageReport,
  IntegrityMatch,
  IntegritySignal,
  PhotoHash,
  PhotoIntegrity,
  PhotoIntegrityPhoto,
} from "../types";
import { loadDemoPhotoHashes, type DemoPhotoHash } from "./demo-photo-hashes";
import { readPhotoExif } from "./exif";
import { compareHashes, hashImage, isPhotoHash, isUniformHash } from "./image-hash";

// Deterministic checks on the evidence the customer sent, run by code. The agent sees the result
// as a tool result (check_photo_integrity), the guardrails act on it (any signal sends the case
// to a human), and the case keeps it. Three questions:
//
//  1. Is a photo the same picture as one filed in another case, for another order or customer?
//     (perceptual hashes stored on every case, compared across the case store)
//  2. Is a photo one of the public demo photos, filed for an order that is not its demo case?
//  3. Does a photo's capture date come before the parcel was delivered?
//
// A signal means "a person should look", never "this is fraud": a customer can legitimately reuse
// a photo (a spare account, a re-filed report under a typo) and a camera clock can be wrong. The
// check never decides anything by itself.
//
// What a missing capture date means: nothing. Most messengers, browsers and phone share sheets
// strip EXIF, so a photo without it is the normal case and is not a signal.

/**
 * A capture date earlier than the delivery by more than this is a signal. EXIF stores local time
 * with no time zone, so the date is read as UTC and the margin absorbs the offset (France is UTC+1
 * or +2) and a delivery time that is only roughly right.
 */
export const EXIF_TOLERANCE_HOURS = 12;

const HOUR_MS = 3_600_000;

/**
 * Only this many of the most recent stored cases are compared with a report (listCases is newest
 * first). Added on 27 Oct 2026 after review: the comparison used to grow with every case the public
 * deployment collects. It bounds the work and what the result says; the case store still reads every
 * case to list them (one Blob read each), which is what INTEGRITY_TIMEOUT in run-agent.ts bounds.
 */
export const MAX_COMPARED_CASES = 200;

/**
 * A photo keeps at most this many matches on its record, the closest first (whatever their number,
 * `matchCount` holds it): someone who files one picture again and again must not make each new
 * record, and the case page, grow with every filing.
 */
export const MAX_STORED_MATCHES = 5;

export interface IntegrityDeps {
  /** Every stored case (their `integrity` holds the hashes to compare with). */
  listCases: () => Promise<CaseRecord[]>;
  /** The bytes of a photo reference of a report. */
  readPhoto: (ref: string) => Promise<Uint8Array>;
  demoPhotos: () => Promise<DemoPhotoHash[]>;
}

export const DEFAULT_INTEGRITY_DEPS: Pick<IntegrityDeps, "readPhoto" | "demoPhotos"> = {
  readPhoto: async (ref) => (await loadImage(ref)).bytes,
  demoPhotos: () => loadDemoPhotoHashes(),
};

/** What reading the photos gave, kept for the whole run so a second call does not hash again. */
export interface PhotoFacts {
  index: number;
  hash: PhotoHash | null;
  unreadable?: string;
  hasExif: boolean;
  capturedAt: string | null;
}

export interface IntegrityCache {
  facts?: Promise<PhotoFacts[]>;
  cases?: Promise<CaseRecord[]>;
}

export interface IntegrityInput {
  report: Pick<DamageReport, "photos" | "orderNumber" | "customerEmail">;
  /** Id of the case being processed: never compared with itself. */
  caseId: string;
  /** Delivery date of the order the agent found; null when there is no order or it is not delivered. */
  deliveredAt: string | null;
  calledBy: "model" | "code";
  now?: Date;
  /** Filled on the first call and reused by the next ones of the same run. */
  cache?: IntegrityCache;
  /**
   * Other cases that must not be compared with this one, besides `caseId`: when a follow-up is saved
   * as a NEW case (a recorded run, 28 Oct 2026) the case it continues holds the same earlier photos,
   * and a customer who corrected the order number would otherwise "reuse" their own photos.
   */
  ignoreCaseIds?: string[];
  /**
   * Photos of a resumed case that an earlier round already read: index in `report.photos` to what
   * was found then (hash, capture date). Those files are not read again, so a follow-up keeps the
   * hashes of every round and does not depend on the old files still being there. Only entries
   * with a hash are used; the others are read again.
   */
  knownPhotos?: PhotoIntegrityPhoto[];
}

const orderKey = (s: string): string => s.replace(/[#\s]/g, "").toLowerCase();
const emailKey = (s: string): string => s.trim().toLowerCase();

async function readFacts(
  photos: string[],
  deps: Pick<IntegrityDeps, "readPhoto">,
  known: PhotoIntegrityPhoto[] = [],
): Promise<PhotoFacts[]> {
  const knownByIndex = new Map(known.filter((p) => p.hash !== null).map((p) => [p.index, p]));
  return Promise.all(
    photos.map(async (ref, index): Promise<PhotoFacts> => {
      const earlier = knownByIndex.get(index);
      if (earlier) return { index, hash: earlier.hash, hasExif: earlier.hasExif, capturedAt: earlier.capturedAt };
      let bytes: Uint8Array;
      try {
        bytes = await deps.readPhoto(ref);
      } catch (e) {
        return { index, hash: null, unreadable: e instanceof Error ? e.message : String(e), hasExif: false, capturedAt: null };
      }
      const [hash, exif] = await Promise.all([hashImage(bytes), readPhotoExif(bytes)]);
      return {
        index,
        hash,
        ...(hash ? {} : { unreadable: "the file could not be decoded as an image" }),
        hasExif: exif.present,
        capturedAt: exif.capture?.date ?? null,
      };
    }),
  );
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function describeGap(hours: number): string {
  if (hours >= 48) return `${Math.round(hours / 24)} days`;
  return `${Math.round(hours)} hours`;
}

/** "2026-10-12T14:03:09" to "2026-10-12 14:03". */
function shortDate(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

export async function checkPhotoIntegrity(input: IntegrityInput, deps: IntegrityDeps): Promise<PhotoIntegrity> {
  const { report, caseId, deliveredAt } = input;
  const cache = input.cache ?? {};
  cache.facts ??= readFacts(report.photos, deps, input.knownPhotos);
  cache.cases ??= deps.listCases();
  const [facts, cases, demos] = await Promise.all([cache.facts, cache.cases, deps.demoPhotos()]);

  const reportOrder = orderKey(report.orderNumber);
  const reportEmail = emailKey(report.customerEmail);
  const sameCustomerAndOrder = (order: string, email: string) =>
    orderKey(order) === reportOrder && emailKey(email) === reportEmail;

  // The hashes already stored on other cases, one entry per photo, from the most recent cases only.
  // A stored photo that is too uniform to mean anything (isUniformHash) is not compared either.
  const stored: { caseId: string; order: string; email: string; hash: PhotoHash }[] = [];
  let comparedCases = 0;
  const ignored = new Set([caseId, ...(input.ignoreCaseIds ?? [])]);
  const others = cases.filter((c) => !ignored.has(c.id));
  const casesNotCompared = Math.max(0, others.length - MAX_COMPARED_CASES);
  for (const c of others.slice(0, MAX_COMPARED_CASES)) {
    const hashes = (c.integrity?.photos ?? []).map((p) => p.hash).filter(isPhotoHash).filter((h) => !isUniformHash(h));
    if (hashes.length === 0) continue;
    comparedCases++;
    for (const hash of hashes) stored.push({ caseId: c.id, order: c.report.orderNumber, email: c.report.customerEmail, hash });
  }

  const signals: IntegritySignal[] = [];
  const notes: string[] = [];
  const photos: PhotoIntegrityPhoto[] = [];
  const delivered = deliveredAt ? Date.parse(deliveredAt) : Number.NaN;
  const missingCapture: number[] = [];
  const unreadable: number[] = [];
  const noDeliveryToCompare: number[] = [];
  const uniform: number[] = [];
  let sameCustomerMatch = false;

  for (const f of facts) {
    const matches: IntegrityMatch[] = [];
    if (f.hash && isUniformHash(f.hash)) {
      // Dark, blank or over-exposed: every such photo hashes alike, so a "match" would say nothing.
      uniform.push(f.index);
    } else if (f.hash) {
      const demoHits = demos
        .map((d) => ({ d, cmp: compareHashes(f.hash as PhotoHash, d.hash) }))
        .filter((x) => x.cmp.match);
      if (demoHits.length > 0) {
        // A demo photo is public: it is only compared with the demo cases, never with other cases.
        for (const { d, cmp } of demoHits) {
          matches.push({
            source: "demo",
            caseId: d.caseId,
            sameOrderAndCustomer: sameCustomerAndOrder(d.orderNumber, d.customerEmail),
            dhashDistance: cmp.dhashDistance,
            ahashDistance: cmp.ahashDistance,
          });
        }
        if (!matches.some((m) => m.sameOrderAndCustomer)) {
          signals.push({
            kind: "demo_photo_reused",
            photoIndex: f.index,
            message: `Photo ${f.index + 1} is one of the demo photos shipped with Gilmend, filed for an order and customer that are not its demo case.`,
          });
        }
      } else {
        for (const s of stored) {
          const cmp = compareHashes(f.hash, s.hash);
          if (!cmp.match) continue;
          matches.push({
            source: "case",
            caseId: s.caseId,
            sameOrderAndCustomer: sameCustomerAndOrder(s.order, s.email),
            dhashDistance: cmp.dhashDistance,
            ahashDistance: cmp.ahashDistance,
          });
        }
        const elsewhere = new Set(matches.filter((m) => !m.sameOrderAndCustomer).map((m) => m.caseId));
        if (elsewhere.size > 0) {
          signals.push({
            kind: "reused_photo",
            photoIndex: f.index,
            message: `Photo ${f.index + 1} looks like a photo already filed in ${elsewhere.size} other ${plural(elsewhere.size, "case", "cases")} for a different order or customer.`,
          });
        }
      }
    } else {
      unreadable.push(f.index);
    }

    if (f.capturedAt) {
      if (Number.isNaN(delivered)) {
        noDeliveryToCompare.push(f.index);
      } else {
        // The date has no zone: read as UTC, with EXIF_TOLERANCE_HOURS of margin (see above).
        const gapHours = (delivered - Date.parse(`${f.capturedAt}Z`)) / HOUR_MS;
        if (gapHours > EXIF_TOLERANCE_HOURS) {
          signals.push({
            kind: "captured_before_delivery",
            photoIndex: f.index,
            message: `Photo ${f.index + 1} says it was taken on ${shortDate(f.capturedAt)}, ${describeGap(gapHours)} before the parcel was delivered (${shortDate(new Date(delivered).toISOString())} UTC).`,
          });
        }
      }
    } else if (f.hash) {
      missingCapture.push(f.index);
    }

    // Counted before the cap below, so the signals, the note and the counts keep the true numbers.
    const otherMatchCount = matches.filter((m) => !m.sameOrderAndCustomer).length;
    if (matches.length > otherMatchCount) sameCustomerMatch = true;
    const kept = [...matches]
      .sort((a, b) => a.dhashDistance + a.ahashDistance - (b.dhashDistance + b.ahashDistance))
      .slice(0, MAX_STORED_MATCHES);

    photos.push({
      index: f.index,
      hash: f.hash,
      ...(f.unreadable ? { unreadable: f.unreadable } : {}),
      ...(f.hash && uniform.includes(f.index) ? { uniform: true } : {}),
      hasExif: f.hasExif,
      capturedAt: f.capturedAt,
      matches: kept,
      ...(matches.length > kept.length ? { matchCount: matches.length, otherMatchCount } : {}),
    });
  }

  const nums = (xs: number[]) => xs.map((i) => i + 1).join(", ");
  if (unreadable.length > 0) {
    notes.push(`Photo ${nums(unreadable)} could not be read or decoded, so it was neither hashed nor compared.`);
  }
  if (uniform.length > 0) {
    notes.push(
      `Photo ${nums(uniform)} is too uniform (dark, blank or over-exposed) to compare: such photos all look alike to a hash, so it was not compared with other photos.`,
    );
  }
  if (casesNotCompared > 0) {
    notes.push(
      `Compared with the ${MAX_COMPARED_CASES} most recent cases only: ${casesNotCompared} older ${plural(casesNotCompared, "case was", "cases were")} left out.`,
    );
  }
  if (missingCapture.length > 0) {
    notes.push(
      `No capture date in the metadata of photo ${nums(missingCapture)}. Most apps and messengers strip it when a photo is shared, so a missing date is normal and is not treated as a signal.`,
    );
  }
  if (noDeliveryToCompare.length > 0) {
    notes.push(
      `Photo ${nums(noDeliveryToCompare)} carries a capture date, but there is no delivery date to compare it with (order not found, or not delivered yet).`,
    );
  }
  const consistent = photos.filter(
    (p) => p.capturedAt && !signals.some((s) => s.kind === "captured_before_delivery" && s.photoIndex === p.index) && !noDeliveryToCompare.includes(p.index),
  );
  if (consistent.length > 0) {
    notes.push(
      `Capture date of photo ${nums(consistent.map((p) => p.index))} is consistent with the delivery date (compared with a ${EXIF_TOLERANCE_HOURS} h margin: EXIF has no time zone). A capture date can be edited, so this proves little.`,
    );
  }
  if (sameCustomerMatch) {
    notes.push(
      "A photo also appears in a case of the same order and customer (or is the demo photo of its own demo case): a report filed again is expected, not a signal.",
    );
  }

  return {
    checkedAt: (input.now ?? new Date()).toISOString(),
    calledBy: input.calledBy,
    photos,
    comparedCases,
    comparedPhotos: stored.length,
    comparedDemoPhotos: demos.length,
    ...(casesNotCompared > 0 ? { casesNotCompared } : {}),
    deliveredAt: Number.isNaN(delivered) ? null : deliveredAt,
    signals,
    notes,
  };
}

const otherMatches = (p: PhotoIntegrityPhoto): number =>
  p.otherMatchCount ?? p.matches.filter((m) => !m.sameOrderAndCustomer).length;

/**
 * What the model is told (and what goes to the trace). The messages hold nothing about another
 * customer: only counts, and the model is told what a signal means and what it must not do.
 */
export function integrityForModel(i: PhotoIntegrity): Record<string, unknown> {
  return {
    checked: true,
    photos: i.photos.map((p) => ({
      photo: p.index + 1,
      hashed: p.hash !== null,
      comparable: p.hash !== null && !p.uniform,
      captureDate: p.capturedAt,
      sameOrderAndCustomerMatches: (p.matchCount ?? p.matches.length) - otherMatches(p),
      otherOrderOrCustomerMatches: otherMatches(p),
    })),
    comparedWith: { earlierCases: i.comparedCases, photos: i.comparedPhotos, demoPhotos: i.comparedDemoPhotos },
    signals: i.signals.map((s) => s.message),
    notes: i.notes,
    next:
      i.signals.length > 0
        ? "Integrity signals found. Set needsHuman=true and say in the reasons that the photos need a check. Do not accuse the customer: a signal is a reason to look, not a finding. The reply must not promise a reshipment or a refund."
        : "No integrity signal. This is not proof that the photos are genuine. A missing capture date is normal.",
  };
}
