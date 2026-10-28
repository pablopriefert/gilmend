import { renderSocialImage } from "@/lib/brand/social-image";

// Open Graph card (link previews in Slack, LinkedIn, Discord, iMessage...). The card itself is in
// src/lib/brand/social-image.tsx; the three exports below are written as literals because Next reads
// them statically and refuses a re-export (social-image.test.tsx keeps them equal to the shared values).
export const alt =
  "Gilmend: Broken parcels, mended in gold. An AI agent that turns a damaged parcel into a ready-to-file carrier claim.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return renderSocialImage();
}
