import "@testing-library/jest-dom/vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Tests must never write into the real data/runtime/: it is part of what a local
// `vercel deploy` uploads, and `npx vitest run` used to leave dozens of PDFs and cases there
// (31 PDFs after one session). Every test file gets a throwaway runtime folder instead.
// A test that needs its own folder stubs DAMAGE_DESK_RUNTIME_DIR and gets this one back after.
const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), "damage-desk-vitest-"));
process.env.DAMAGE_DESK_RUNTIME_DIR = runtimeRoot;
afterAll(() => rmSync(runtimeRoot, { recursive: true, force: true }));

// The committed showcase (data/showcase/, six recorded real runs) is layered under every case
// store. Tests of the store, the routes and the pages assume an empty inbox, so they get a
// folder that does not exist; the showcase tests point DAMAGE_DESK_SHOWCASE_DIR at the real one.
process.env.DAMAGE_DESK_SHOWCASE_DIR = path.join(runtimeRoot, "no-showcase");

// Unmount components between tests; a no-op in node-environment tests.
afterEach(() => cleanup());

// jsdom has no IntersectionObserver, and the Arc animated counter (src/components/arc) uses one
// through motion's useInView. A no-op stand-in is enough: a test that renders a counter reads its
// text (the counter also writes the value as screen-reader text), never its on-screen animation.
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// jsdom does not implement Element.prototype.scrollTo; components that scroll a list into view
// call it, and a missing method would throw in a test. Guarded so a real implementation wins.
if (typeof Element !== "undefined") {
  (Element.prototype as { scrollTo?: unknown }).scrollTo ??= () => {};
}
// jsdom's window.scrollTo exists but only logs "Not implemented" (64 lines per run, from the Arc
// timeline in the trace): a silent stand-in keeps real failures visible in the test output.
if (typeof window !== "undefined") {
  window.scrollTo = () => {};
}
