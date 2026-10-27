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

// Unmount components between tests; a no-op in node-environment tests.
afterEach(() => cleanup());
