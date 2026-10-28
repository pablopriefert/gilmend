import { ImageResponse } from "next/og";

// The social preview of Gilmend (Open Graph and Twitter/X card), drawn in code so it can never drift
// from the product: same tokens as src/app/globals.css, same mark as src/components/brand/logo.tsx.
//
// The values below are copies of the CSS tokens (ImageResponse cannot read a stylesheet or a CSS
// variable). Keep them in step with docs/design.md; src/lib/brand/social-image.test.tsx pins them to
// globals.css so a change of palette is noticed here.
export const SOCIAL_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const SOCIAL_IMAGE_ALT =
  "Gilmend: Broken parcels, mended in gold. An AI agent that turns a damaged parcel into a ready-to-file carrier claim.";

export const SOCIAL_TOKENS = {
  paper: "#f6f4ef", // --background
  ink: "#15161c", // --ink
  muted: "#5d5a53", // --muted (5.8:1 on paper)
  border: "#e4ded1", // --border
  gold: "#c9971f", // --gold: decor only, never text
  goldInk: "#7a560a", // --gold-ink: gold for text
  goldSoft: "#fbf3dc", // --gold-soft
} as const;

export const TAGLINE = "Broken parcels, mended in gold.";
export const PITCH = "An AI agent that turns a damaged parcel into a ready-to-file carrier claim.";
export const STACK_LINE = "Muse Spark 1.3 · SAM 3.1";

// The logo mark, recreated as a plain SVG (the component uses a React hook for its gradient id and
// CSS variables, neither of which ImageResponse supports). Same geometry as src/app/icon.svg.
function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gilmend-gold" x1="6" y1="9" x2="26" y2="23" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f3d27a" />
          <stop offset="0.55" stopColor="#d4a537" />
          <stop offset="1" stopColor="#a87a1a" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill={SOCIAL_TOKENS.ink} />
      <path d="M16 4.5v23" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="2" />
      <path
        d="M6 9.5 12.2 14.6 10.6 18.4 17.4 21 21 17.2 26 22.5"
        fill="none"
        stroke="url(#gilmend-gold)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17.4 21 18.6 25.6" fill="none" stroke="url(#gilmend-gold)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// A wide gold seam along the bottom of the card: the same kintsugi crack as the mark, stretched, so
// the card reads as "a break, kept and filled with gold" even at thumbnail size.
function Seam() {
  return (
    <svg
      width={SOCIAL_IMAGE_SIZE.width}
      height="120"
      viewBox="0 0 1200 120"
      xmlns="http://www.w3.org/2000/svg"
      style={{ position: "absolute", left: 0, bottom: 0 }}
    >
      <defs>
        <linearGradient id="gilmend-seam" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f3d27a" />
          <stop offset="0.55" stopColor="#d4a537" />
          <stop offset="1" stopColor="#a87a1a" />
        </linearGradient>
      </defs>
      <path
        d="M0 78 150 62 232 92 340 70 452 96 560 66 668 88 790 58 902 84 1030 64 1200 86"
        fill="none"
        stroke="url(#gilmend-seam)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M452 96 470 118" fill="none" stroke="url(#gilmend-seam)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/** The 1200x630 card, shared by opengraph-image.tsx and twitter-image.tsx. */
export function renderSocialImage(): ImageResponse {
  const t = SOCIAL_TOKENS;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: t.paper,
          color: t.ink,
          padding: "72px 72px 56px",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <Mark size={76} />
          <div style={{ display: "flex", marginLeft: 22, fontSize: 44, letterSpacing: "-0.035em" }}>Gilmend</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 94,
              lineHeight: 1.02,
              letterSpacing: "-0.045em",
              // Narrow enough that the line breaks after the comma, not before "in gold.".
              maxWidth: 800,
            }}
          >
            {TAGLINE}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 28,
              fontSize: 30,
              lineHeight: 1.3,
              color: t.muted,
              maxWidth: 1056,
            }}
          >
            {PITCH}
          </div>
          <div style={{ display: "flex", marginTop: 26, fontSize: 28, color: t.goldInk, letterSpacing: "-0.01em" }}>
            {STACK_LINE}
          </div>
        </div>

        {/* Keeps the seam clear of the text above it. */}
        <div style={{ display: "flex", height: 36 }} />
        <Seam />
      </div>
    ),
    { ...SOCIAL_IMAGE_SIZE },
  );
}
