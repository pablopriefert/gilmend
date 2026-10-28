import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import * as openGraph from "@/app/opengraph-image";
import * as twitter from "@/app/twitter-image";
import { SOCIAL_IMAGE_ALT, SOCIAL_IMAGE_SIZE, SOCIAL_TOKENS } from "./social-image";

// The card is drawn by next/og (satori + resvg). These tests render it for real in node: they check
// the route's exports (what Next turns into the og:image and twitter:image tags) and the bytes it
// returns, not a mock.

const cssToken = (name: string): string => {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --${name} not found in globals.css`);
  return match[1].toLowerCase();
};

describe.each([
  ["opengraph-image", openGraph],
  ["twitter-image", twitter],
])("%s route", (_name, route) => {
  it("declares a 1200x630 PNG with the shared alt text", () => {
    expect(route.size).toEqual({ width: 1200, height: 630 });
    expect(route.size).toEqual(SOCIAL_IMAGE_SIZE);
    expect(route.contentType).toBe("image/png");
    expect(route.alt).toBe(SOCIAL_IMAGE_ALT);
    expect(route.alt).toContain("Broken parcels, mended in gold");
  });

  it("renders a real 1200x630 PNG", async () => {
    const response = await Promise.resolve(route.default());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    // PNG signature, then the real dimensions read back by sharp.
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
    // Well under the 5 MB X limit (and 8 MB for Open Graph).
    expect(bytes.length).toBeLessThan(500_000);
  }, 30_000);

  it("is not a blank card: the paper background, ink text and a gold seam are all in the picture", async () => {
    const response = await Promise.resolve(route.default());
    const { data, info } = await sharp(Buffer.from(await response.arrayBuffer()))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const hex = (rgb: number[]) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
    // Top-right corner: nothing is drawn there, it is the paper.
    expect(hex(pixel(1190, 10))).toBe(SOCIAL_TOKENS.paper);
    // Count dark (ink) and golden pixels over the whole card.
    let dark = 0;
    let gold = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r < 60 && g < 60 && b < 70) dark++;
      if (r > 180 && g > 130 && g < 215 && b < 120 && r - b > 90) gold++;
    }
    expect(dark).toBeGreaterThan(5_000);
    expect(gold).toBeGreaterThan(1_500);
  }, 30_000);
});

describe("social card tokens", () => {
  it("copies the design tokens of globals.css (docs/design.md)", () => {
    expect(SOCIAL_TOKENS.paper).toBe(cssToken("background"));
    expect(SOCIAL_TOKENS.ink).toBe(cssToken("ink"));
    expect(SOCIAL_TOKENS.muted).toBe(cssToken("muted"));
    expect(SOCIAL_TOKENS.gold).toBe(cssToken("gold"));
    expect(SOCIAL_TOKENS.goldInk).toBe(cssToken("gold-ink"));
  });
});
