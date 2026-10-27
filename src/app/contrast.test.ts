import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every text colour of the design system against the backgrounds it is used on, read from
// globals.css itself so a palette change cannot skip the check (WCAG 2.x AA: 4.5:1 for text).
const css = readFileSync(path.join(__dirname, "globals.css"), "utf8");
function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token --${name} not found`);
  return m[1];
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ["foreground", "muted", "accent", "gold-ink", "success", "warning", "danger"];
const BACKGROUNDS = ["surface", "background", "surface-muted"];

describe("design system contrast (WCAG AA)", () => {
  for (const fg of TEXT) {
    for (const bg of BACKGROUNDS) {
      it(`--${fg} on --${bg} is at least 4.5:1`, () => {
        expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it("tinted status pills keep 4.5:1", () => {
    for (const [fg, bg] of [["success", "success-soft"], ["warning", "warning-soft"], ["danger", "danger-soft"], ["gold-ink", "gold-soft"], ["accent", "accent-soft"]]) {
      expect(contrast(token(fg), token(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("white text on the ink button and on the accent", () => {
    expect(contrast("#ffffff", token("ink"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", token("accent"))).toBeGreaterThanOrEqual(4.5);
  });
});
