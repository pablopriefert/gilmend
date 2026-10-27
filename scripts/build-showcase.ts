// `npm run showcase:build -- --from <runtime dir>`: turns real runs recorded with
// `npm run real` (cases named real_*, in <runtime dir>/cases) into the committed, read-only
// showcase folder data/showcase/ that the app lists and serves (src/lib/showcase).
//
// It copies each case with the files it points to, rewrites their paths to the logical
// "data/showcase/..." paths, marks the case `recorded`, and REFUSES to write anything that
// does not pass the publication audit (src/lib/showcase/audit.ts): only the invented orders of
// data/fixtures/orders.json, only example.* e-mails, no key, no path of this machine. It never
// calls a model and never prints case content.
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseFixtureOrders } from "../src/lib/orders/fixtures";
import { auditShowcaseCase, auditText, carrierEmails, pdfText, referencedFiles } from "../src/lib/showcase/audit";
import { SHOWCASE_PATH_PREFIX } from "../src/lib/showcase/showcase";
import type { CaseRecord } from "../src/lib/types";

const ROOT = process.cwd();

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

/** Where a path stored in a recorded case lives on disk, and where it goes in the showcase. */
function plan(stored: string, runtime: string): { from: string; to: string } {
  const name = path.posix.basename(stored);
  if (stored.startsWith("data/photos/")) return { from: path.join(ROOT, stored), to: `photos/${name}` };
  if (stored.startsWith("data/runtime/evidence/")) return { from: path.join(runtime, "evidence", name), to: `evidence/${name}` };
  if (stored.startsWith("data/runtime/claims/")) return { from: path.join(runtime, "claims", name), to: `claims/${name}` };
  throw new Error(`Unexpected file path in a recorded case: ${stored}`);
}

function rewrite(value: unknown, mapping: Map<string, string>): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const [stored, logical] of mapping) out = out.split(stored).join(logical);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => rewrite(v, mapping));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, mapping)]));
  }
  return value;
}

async function main(): Promise<void> {
  const runtime = argument("from");
  if (!runtime) {
    console.error("Usage: npm run showcase:build -- --from <runtime dir> [--recorded-on YYYY-MM-DD] [--out data/showcase]");
    process.exit(1);
  }
  const recordedOn = argument("recorded-on") ?? "2026-10-27";
  const out = path.resolve(ROOT, argument("out") ?? "data/showcase");

  const names = (await readdir(path.join(runtime, "cases"))).filter((n) => /^real_.+\.json$/.test(n)).sort();
  if (names.length === 0) throw new Error(`No real_*.json case in ${path.join(runtime, "cases")}`);

  const fixtures = parseFixtureOrders(JSON.parse(readFileSync(path.join(ROOT, "data/fixtures/orders.json"), "utf8")));
  const allowedEmails = carrierEmails(readFileSync(path.join(ROOT, "data/carriers.json"), "utf8"));

  const problems: string[] = [];
  const cases: CaseRecord[] = [];
  const copies = new Map<string, string>(); // destination (relative to out) -> source file

  for (const name of names) {
    const original = JSON.parse(await readFile(path.join(runtime, "cases", name), "utf8")) as CaseRecord;
    const mapping = new Map<string, string>();
    for (const stored of new Set(referencedFiles(original))) {
      const { from, to } = plan(stored, runtime);
      if (!existsSync(from)) throw new Error(`Missing file for ${original.id}: ${path.basename(from)}`);
      mapping.set(stored, `${SHOWCASE_PATH_PREFIX}${to}`);
      copies.set(to, from);
    }
    const recorded = { ...(rewrite(original, mapping) as CaseRecord), recorded: { recordedOn } };
    cases.push(recorded);
  }

  for (const [to, from] of copies) {
    if (!to.endsWith(".pdf")) continue;
    const found = auditText(pdfText(await readFile(from)), allowedEmails, { longTokens: false });
    for (const p of found) problems.push(`${to}: ${p}`);
  }
  for (const c of cases) {
    const found = auditShowcaseCase(c, {
      fixtures,
      allowedEmails,
      // The files are not copied yet: they exist when the source of their copy does.
      fileExists: (logical) => copies.has(logical.slice(SHOWCASE_PATH_PREFIX.length)),
    });
    for (const p of found) problems.push(`${c.id}: ${p}`);
  }
  if (problems.length > 0) {
    console.error("Showcase NOT written. The audit found:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  for (const folder of ["cases", "photos", "evidence", "claims"]) await rm(path.join(out, folder), { recursive: true, force: true });
  for (const [to, from] of copies) {
    await mkdir(path.dirname(path.join(out, to)), { recursive: true });
    await copyFile(from, path.join(out, to));
  }
  await mkdir(path.join(out, "cases"), { recursive: true });
  for (const c of cases) await writeFile(path.join(out, "cases", `${c.id}.json`), `${JSON.stringify(c, null, 2)}\n`, "utf8");

  console.log(`Showcase written to ${path.relative(ROOT, out)}: ${cases.length} cases, ${copies.size} files, audit clean.`);
}

main().catch((error) => {
  console.error("showcase build failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
