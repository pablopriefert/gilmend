import { describe, expect, it } from "vitest";
import { photoSrc } from "./photo-src";

describe("photoSrc", () => {
  it("serves runtime and showcase files through /api/files", () => {
    expect(photoSrc("data/runtime/evidence/abc-annotated.jpg")).toBe("/api/files?p=evidence%2Fabc-annotated.jpg");
    expect(photoSrc("data/showcase/photos/vase-broken.webp")).toBe("/api/files?p=showcase%2Fphotos%2Fvase-broken.webp");
  });

  it("serves a demo photo referenced in place by its name, not its path", () => {
    // Cases made by `npm run real` keep the demo photo where it is; the case page showed
    // "Photo unavailable" for it.
    expect(photoSrc("data/photos/vase-broken.webp")).toBe("/api/demo-photo?name=vase-broken");
    expect(photoSrc("/repo/data/photos/carafe-cracked.jpg")).toBe("/api/demo-photo?name=carafe-cracked");
    expect(photoSrc("data/photos/../secrets.webp")).toBe("");
  });

  it("keeps data URLs and rejects what it cannot serve", () => {
    expect(photoSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(photoSrc("")).toBe("");
    expect(photoSrc("notes.txt")).toBe("");
  });
});
