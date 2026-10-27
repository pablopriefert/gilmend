import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// `npm run dev:demo` and `start:demo` promise "never spends credits": they work by emptying, for
// that one process, every variable that makes an engine real, because Next.js loads .env.local.
// A key added for a new engine that is missing here would silently spend money in demo mode.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

const REAL_ENGINE_VARIABLES = [
  "MODEL_API_KEY",
  "OPEN_WEIGHTS_BASE_URL",
  "OPEN_WEIGHTS_MODEL",
  "BASETEN_API_KEY",
  "OPENROUTER_API_KEY",
];

describe("the demo-mode scripts", () => {
  for (const name of ["dev:demo", "start:demo"]) {
    it(`${name} empties every variable that makes an engine real`, () => {
      for (const v of REAL_ENGINE_VARIABLES) {
        expect(pkg.scripts[name], `${name} must empty ${v}`).toMatch(new RegExp(`(^| )${v}=( |$)`));
      }
    });
  }

  it("every engine key documented in .env.example is covered by that list", () => {
    const example = readFileSync(path.resolve(__dirname, "..", ".env.example"), "utf8");
    const keys = [...example.matchAll(/^([A-Z_]*API_KEY)=/gm)].map((m) => m[1]);
    // OPEN_WEIGHTS_API_KEY only authenticates a base URL that is already emptied above.
    for (const k of keys.filter((k) => k !== "OPEN_WEIGHTS_API_KEY")) expect(REAL_ENGINE_VARIABLES).toContain(k);
  });
});
