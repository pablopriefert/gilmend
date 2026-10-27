import type { Evidence } from "../types";

/**
 * One Evidence per customer photo, in the order the customer sent them. A photo the agent
 * ran through mark_damage keeps its Evidence (annotated or not); every other photo gets a
 * raw-photo entry. Before 27 Oct 2026 the case page and the claim PDF showed `evidence`
 * INSTEAD of the report's photos as soon as it was non-empty: with 3 photos and a single
 * mark_damage call, the other two (box, padding: documents a carrier asks for) vanished.
 * Evidence about a photo that is not in the report is ignored.
 */
export function evidenceForPhotos(photos: string[], evidence: Evidence[]): Evidence[] {
  return photos.map(
    (photo) =>
      evidence.find((e) => e.photo === photo) ?? {
        photo,
        annotatedPhoto: null,
        method: "none" as const,
        note: "",
      },
  );
}
