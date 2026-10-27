// Kept as a re-export: the evidence and document modules import from here, the rule itself
// lives in src/lib/runtime-dir.ts (one rule for uploads, cases, PDFs and evidence).
export { runtimeDir, safeFileStem, toStoredPath } from "../runtime-dir";
