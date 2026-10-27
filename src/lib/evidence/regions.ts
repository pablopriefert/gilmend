import type { SamDetection } from "./sam";

// Several SAM concepts can outline the same thing ("ceramic vase" and "white ceramic vase" both
// find the vase), so the regions of different concepts are merged before they are drawn:
// without it the same outline would be painted twice and take the places of the other regions.

/** Two boxes that overlap more than this (intersection over union) are the same region. */
export const SAME_REGION_IOU = 0.5;

/** Intersection over union of two boxes (right and bottom are exclusive edges). 0 when disjoint. */
export function boxIou(a: SamDetection["box"], b: SamDetection["box"]): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (width <= 0 || height <= 0) return 0;
  const intersection = width * height;
  const union = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - intersection;
  return union > 0 ? intersection / union : 0;
}

export interface ConceptRegions {
  concept: string;
  regions: SamDetection[];
}

export interface MergedRegions {
  /** Best first, at most `max`, no two of them the same region. */
  regions: SamDetection[];
  /** How many of the kept regions each concept brought, in the order the concepts were tried. */
  byConcept: Array<{ concept: string; count: number }>;
}

const score = (d: SamDetection) => d.confidence ?? 1;

/**
 * Merge the regions found for several concepts: keep the most confident first, drop a region
 * whose box overlaps one already kept by more than SAME_REGION_IOU (so the concept that found
 * it with the higher confidence gets the credit), and keep at most `max`.
 */
export function mergeRegions(found: readonly ConceptRegions[], max: number): MergedRegions {
  const all = found.flatMap(({ concept, regions }, order) => regions.map((region) => ({ concept, region, order })));
  // Stable on ties: the concept tried first wins, so the note does not depend on array luck.
  all.sort((a, b) => score(b.region) - score(a.region) || a.order - b.order);

  const kept: typeof all = [];
  for (const candidate of all) {
    if (kept.length >= max) break;
    if (kept.some((k) => boxIou(k.region.box, candidate.region.box) > SAME_REGION_IOU)) continue;
    kept.push(candidate);
  }

  const byConcept = found
    .map(({ concept }) => ({ concept, count: kept.filter((k) => k.concept === concept).length }))
    .filter((c) => c.count > 0);
  return { regions: kept.map((k) => k.region), byConcept };
}

/** At least this many regions from ONE concept is enough evidence: no further SAM call. */
export const STRONG_MIN_REGIONS = 2;
/** ... as long as they are not mostly marginal. */
export const STRONG_MIN_MEAN_CONFIDENCE = 0.5;

/**
 * Whether one concept already gave enough regions to stop asking. A single region is not:
 * SAM often answers a product noun with one box around the whole object ("white ceramic vase"
 * found only the vase neck on 27 Oct 2026, "broken pottery" found 26 shards on the same photo),
 * so one region leaves room for another concept to add what that one missed.
 */
export function isStrong(regions: readonly SamDetection[]): boolean {
  if (regions.length < STRONG_MIN_REGIONS) return false;
  const scores = regions.map((r) => r.confidence).filter((c): c is number => c !== null);
  if (scores.length === 0) return true;
  return scores.reduce((sum, c) => sum + c, 0) / scores.length >= STRONG_MIN_MEAN_CONFIDENCE;
}
