import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseConcept } from "../agent/tools";
import { hasModelKey, type Env } from "../config";
import { persistRuntimeFile } from "../storage/runtime-files";
import type { DamageAssessment, Engine, Evidence } from "../types";
import { annotateImage } from "./annotate";
import { loadImage, normaliseImage, type LoadImageOptions } from "./image-io";
import { isStrong, mergeRegions, type ConceptRegions } from "./regions";
import { runtimeDir, toStoredPath } from "./runtime-dir";
import { SAM_MODEL, segmentConcept, type SamDetection, type SamOptions } from "./sam";

// Long side sent to SAM and kept for the annotated evidence. Big enough to see a crack,
// small enough to keep the payload (and the PDF) light.
const MAX_LONG_SIDE = 2048;
// SAM scores 0..1 per region. Below this a region is more likely noise than damage, and an
// outline on the wrong spot in a claim is worse than no outline.
const MIN_CONFIDENCE = 0.3;
const MAX_REGIONS = 5;

// SAM takes short, concrete noun phrases (not commands or sentences) and one concept per
// request. Each call costs $2.50 per 1,000 images, so at most MAX_SAM_CALLS are made per photo.
const MAX_SAM_CALLS = 3;
// SAM finds things, not states. Probe of 27/10/2026 on the six demo photos
// (scripts/sam-probe.ts): "crack", "dent", "broken glass", "broken vase" and
// "shattered vase" matched nothing anywhere; "broken pottery" (26 shards on the vase),
// "glass carafe", "ear cup", "headphones", "torn cardboard" and "cardboard box" did.
// A second probe the same day showed that the NOUN the model picks decides the evidence:
// on the vase photo "broken pottery" and "broken ceramic" found 26 and 30 shards, "ceramic
// vase" found nothing and "vase" one region. The concepts of the damaged item are therefore
// asked together and their regions merged (see damageConceptsFor), not "first match wins".
// The parcel itself is the last resort: an outline of the box is weaker evidence than one of
// the broken item, but it is still evidence, and it is only asked when nothing about the
// item matched.
export const DEFAULT_DAMAGE_CONCEPTS = ["torn cardboard", "cardboard box"] as const;

export interface MarkDamageOptions extends SamOptions, LoadImageOptions {
  /**
   * The engine of the case. SAM runs on the Meta Model API, so it is only called for
   * "muse-spark-1.3". A "Run privately" case (open weights) promises that nothing goes to
   * the Model API, and a DEMO MODE case must not trigger a paid call nor claim a SAM
   * annotation. Left undefined (direct calls, older tests) the decision is the key alone.
   */
  engine?: Engine;
  /**
   * Noun phrases about the damaged item, asked in order and MERGED: the loop stops early only
   * when one of them already gave strong regions (isStrong). At most MAX_SAM_CALLS per photo,
   * shared with `fallbackConcepts`.
   */
  concepts?: readonly string[];
  /**
   * Last resort, asked in order only when nothing in `concepts` matched, stopping at the first
   * match; defaults to the packaging vocabulary (the parcel itself).
   */
  fallbackConcepts?: readonly string[];
  /** Redirect data/runtime (tests). */
  runtimeDir?: string;
  /** Silence the log line (tests). */
  quiet?: boolean;
}

/**
 * The item named in the assessment as a SAM noun phrase ("Glass carafe, 1 L" -> "glass
 * carafe"), or null when it cannot be one. Keeps the last three words of the part before
 * the first comma or bracket: the head noun of an English noun phrase comes last.
 */
export function itemConcept(item: string | undefined): string | null {
  if (!item) return null;
  const head = item.split(/[,(\[;:]| - /)[0].toLowerCase().replace(/[^a-z -]+/g, " ");
  // A one-letter word is what is left of a size or a unit ("glass water carafe 1L" gave
  // "water carafe l" in the real run of 27 Oct 2026, a wasted SAM call): drop it.
  const words = head.trim().split(/\s+/).filter((w) => w.length > 1).slice(-3);
  return parseConcept(words.join(" "));
}

const MATERIAL_CONCEPTS: Array<[RegExp, string]> = [
  // Probed 27/10/2026: "broken pottery" outlines the shards of a ceramic vase (26 regions).
  [/\b(ceramic|porcelain|stoneware|earthenware|terracotta|pottery|clay)\b/, "broken pottery"],
  // No entry for glass: "broken glass" and "glass shard" matched nothing on the carafe photo,
  // so a glass item is outlined by its own noun ("glass carafe"), which did.
];

/**
 * A "broken <material>" concept derived from the item of the assessment, or null when no
 * material is named or none was shown to work with SAM. It outlines the shards, which a noun
 * for the whole product ("ceramic vase") does not.
 */
export function materialConcept(item: string | undefined): string | null {
  if (!item) return null;
  const lower = item.toLowerCase();
  for (const [pattern, concept] of MATERIAL_CONCEPTS) if (pattern.test(lower)) return concept;
  return null;
}

/**
 * What to ask SAM for one photo, so the evidence does not hang on the single word the model
 * picked. `concepts` are about the damaged item and are merged: the model's concept, then a
 * "broken <material>" concept when the item names a material, else the item noun (for a
 * crushed or opened parcel, the cardboard). `fallbackConcepts` is the packaging, asked only
 * when nothing about the item matched.
 */
export function damageConceptsFor(
  modelConcept: string | null,
  assessment: DamageAssessment | null,
): { concepts: string[]; fallbackConcepts: string[] } {
  const material = assessment?.damageType === "broken_product" ? materialConcept(assessment.item) : null;
  const concepts = [modelConcept, material ?? damageConceptFor(assessment)].filter(
    (c): c is string => typeof c === "string",
  );
  return { concepts: [...new Set(concepts)], fallbackConcepts: [...DEFAULT_DAMAGE_CONCEPTS] };
}

/**
 * A SAM noun phrase for what the assessment says is damaged, or null when there is nothing
 * to outline (a missing item or an unclear photo has no visible damaged region). For a
 * broken product it is the product itself: SAM outlines objects, not cracks.
 */
export function damageConceptFor(assessment: DamageAssessment | null): string | null {
  switch (assessment?.damageType) {
    case "broken_product":
      return itemConcept(assessment.item);
    case "crushed_packaging":
    case "opened_parcel":
      return "torn cardboard";
    default:
      return null;
  }
}

function none(photo: string, note: string, quiet?: boolean): Evidence {
  // Logs say it plainly: the claim ships with the raw photo, nothing was segmented.
  if (!quiet) console.warn(`[damage-desk] mark_damage: no SAM annotation (${note})`);
  return { photo, annotatedPhoto: null, method: "none", note };
}

function usable(detections: SamDetection[]): SamDetection[] {
  return detections
    .filter((d) => d.confidence === null || d.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1))
    .slice(0, MAX_REGIONS);
}

/**
 * Outline the damaged area of a photo with SAM 3.1 (Meta Model API) and save the annotated
 * image. Never throws and never fakes a result: without MODEL_API_KEY, or when the call,
 * the photo or the drawing fails, it returns method 'none' with a note and the claim
 * ships with the raw photo.
 */
export async function markDamage(photo: string, options: MarkDamageOptions = {}): Promise<Evidence> {
  const env: Env = options.env ?? process.env;
  const quiet = options.quiet;

  if (options.engine === "open-weights") {
    return none(
      photo,
      "Raw photo: private run (open weights). SAM runs on the Meta Model API, so it was not called: in a private run the photos go only to the open-weights host.",
      quiet,
    );
  }
  if (options.engine === "openrouter") {
    return none(
      photo,
      "Raw photo: OpenRouter test engine. SAM runs on the Meta Model API, so it was not called; the photos still go to OpenRouter and the model's provider.",
      quiet,
    );
  }
  if (options.engine === "demo-mock") {
    return none(photo, "Raw photo: DEMO MODE. SAM was not called (no image was analysed).", quiet);
  }
  if (!hasModelKey(env)) {
    return none(photo, "MODEL_API_KEY is not set (demo mode): the raw photo is used as evidence.", quiet);
  }

  try {
    const loaded = await loadImage(photo, options);
    const image = await normaliseImage(loaded.bytes, MAX_LONG_SIDE);
    const dataUrl = `data:image/jpeg;base64,${image.jpeg.toString("base64")}`;

    const primary = [...new Set(options.concepts ?? [])];
    const fallback = [...new Set(options.fallbackConcepts ?? DEFAULT_DAMAGE_CONCEPTS)];
    const tried: string[] = [];
    const found: ConceptRegions[] = [];
    const state = { failure: null as string | null };
    // One SAM call. An error after something was already found keeps what was found (the
    // outline is still true); with nothing found yet it is the caller's "SAM call failed".
    const ask = async (concept: string): Promise<number> => {
      tried.push(concept);
      try {
        const regions = usable(await segmentConcept(dataUrl, concept, { ...options, env }));
        if (regions.length > 0) found.push({ concept, regions });
        return regions.length;
      } catch (error) {
        if (found.length === 0) throw error;
        state.failure = error instanceof Error ? error.message : "unknown error";
        return 0;
      }
    };
    const canAsk = (concept: string) =>
      !tried.includes(concept) && tried.length < MAX_SAM_CALLS && state.failure === null;

    for (const concept of primary) {
      if (!canAsk(concept)) continue;
      await ask(concept);
      const last = found[found.length - 1];
      if (last?.concept === concept && isStrong(last.regions)) break;
    }
    if (found.length === 0) {
      for (const concept of fallback) {
        if (!canAsk(concept)) continue;
        if ((await ask(concept)) > 0) break;
      }
    }
    if (found.length === 0) {
      return none(
        photo,
        `SAM ${SAM_MODEL} found no region matching ${tried.map((c) => `"${c}"`).join(", ")}: the raw photo is used as evidence.`,
        quiet,
      );
    }

    const merged = mergeRegions(found, MAX_REGIONS);
    const regions = merged.regions;
    // The concepts that matched, with what each brought; a single concept reads as before.
    const matchedText =
      merged.byConcept.length === 1
        ? `matching "${merged.byConcept[0].concept}"`
        : `from ${merged.byConcept.length} concepts: ${merged.byConcept.map((c) => `"${c.concept}" ${c.count}`).join(", ")}`;
    // A concept can match and still add no region of its own (same box as a more confident
    // one, or cut by the limit of 5): the note says so instead of listing it as unmatched.
    const absorbed = found
      .filter((f) => !merged.byConcept.some((c) => c.concept === f.concept))
      .map((f) => `"${f.concept}"`);
    const unmatched = tried.filter((c) => !found.some((f) => f.concept === c)).map((c) => `"${c}"`);

    const annotated = await annotateImage(image.jpeg, regions);
    const root = runtimeDir(options.runtimeDir);
    const dir = path.join(root, "evidence");
    await mkdir(dir, { recursive: true });
    const stem = createHash("sha256")
      .update(image.jpeg)
      .update(merged.byConcept.map((c) => c.concept).join("|"))
      .digest("hex")
      .slice(0, 16);
    const file = path.join(dir, `${stem}-annotated.jpg`);
    await writeFile(file, annotated);
    // Copy to the shared store when one is configured (no-op otherwise), so the claim page
    // served by another instance can show the annotated photo.
    await persistRuntimeFile(file, root);

    const scores = regions
      .map((r) => r.confidence)
      .filter((c): c is number => c !== null)
      .map((c) => c.toFixed(2));
    return {
      photo,
      annotatedPhoto: toStoredPath(file),
      method: "sam-3.1",
      note:
        `SAM 3.1 outlined ${regions.length} region${regions.length > 1 ? "s" : ""} ${matchedText}` +
        (scores.length ? ` (confidence ${scores.join(", ")})` : "") +
        "." +
        (absorbed.length ? ` Also matched ${absorbed.join(", ")}, with regions already kept or less confident.` : "") +
        (unmatched.length ? ` No region for ${unmatched.join(", ")}.` : "") +
        (state.failure ? ` A later SAM call failed (${state.failure}), so the outline may be incomplete.` : "") +
        " The outline marks where the damage appears to be; it is not a damage verdict.",
    };
  } catch (error) {
    // Message only, never the request (it holds the photo and the key header).
    const reason = error instanceof Error ? error.message : "unknown error";
    return none(photo, `SAM call failed (${reason}): the raw photo is used as evidence.`, quiet);
  }
}
