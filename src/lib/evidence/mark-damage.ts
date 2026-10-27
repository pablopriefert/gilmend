import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseConcept } from "../agent/tools";
import { hasModelKey, type Env } from "../config";
import { persistRuntimeFile } from "../storage/runtime-files";
import type { DamageAssessment, Engine, Evidence } from "../types";
import { annotateImage } from "./annotate";
import { loadImage, normaliseImage, type LoadImageOptions } from "./image-io";
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
// request, so we try these in order and keep the first that matches. Each call costs
// $2.50 per 1,000 images, so the list stays short.
// SAM finds things, not states. Probe of 27/10/2026 on the six demo photos
// (scripts/sam-probe.ts): "crack", "dent", "broken glass", "broken vase" and
// "shattered vase" matched nothing anywhere; "broken pottery" (26 shards on the vase),
// "glass carafe", "ear cup", "headphones", "torn cardboard" and "cardboard box" did.
// The last resort is therefore the parcel itself: an outline of the box is weaker
// evidence than one of the broken item, but it is still evidence.
export const DEFAULT_DAMAGE_CONCEPTS = ["torn cardboard", "cardboard box"] as const;

export interface MarkDamageOptions extends SamOptions, LoadImageOptions {
  /**
   * The engine of the case. SAM runs on the Meta Model API, so it is only called for
   * "muse-spark-1.3". A "Run privately" case (open weights) promises that nothing goes to
   * the Model API, and a DEMO MODE case must not trigger a paid call nor claim a SAM
   * annotation. Left undefined (direct calls, older tests) the decision is the key alone.
   */
  engine?: Engine;
  /** Noun phrases to try in order; defaults to a generic damage vocabulary. */
  concepts?: readonly string[];
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
  const words = head.trim().split(/\s+/).filter(Boolean).slice(-3);
  return parseConcept(words.join(" "));
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
      "Raw photo: private run (open weights). SAM runs on the Meta Model API, so it was not called and the photo never left this run.",
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

    const concepts = options.concepts?.length ? options.concepts : DEFAULT_DAMAGE_CONCEPTS;
    let regions: SamDetection[] = [];
    let matched = "";
    for (const concept of concepts) {
      regions = usable(await segmentConcept(dataUrl, concept, { ...options, env }));
      if (regions.length > 0) {
        matched = concept;
        break;
      }
    }
    if (regions.length === 0) {
      return none(
        photo,
        `SAM ${SAM_MODEL} found no region matching ${concepts.map((c) => `"${c}"`).join(", ")}: the raw photo is used as evidence.`,
        quiet,
      );
    }

    const annotated = await annotateImage(image.jpeg, regions);
    const root = runtimeDir(options.runtimeDir);
    const dir = path.join(root, "evidence");
    await mkdir(dir, { recursive: true });
    const stem = createHash("sha256").update(image.jpeg).update(matched).digest("hex").slice(0, 16);
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
        `SAM 3.1 outlined ${regions.length} region${regions.length > 1 ? "s" : ""} matching "${matched}"` +
        (scores.length ? ` (confidence ${scores.join(", ")})` : "") +
        ". The outline marks where the damage appears to be; it is not a damage verdict.",
    };
  } catch (error) {
    // Message only, never the request (it holds the photo and the key header).
    const reason = error instanceof Error ? error.message : "unknown error";
    return none(photo, `SAM call failed (${reason}): the raw photo is used as evidence.`, quiet);
  }
}
