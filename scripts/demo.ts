// `npm run demo`: runs the demo cases of the video (six, and a German seventh since 28 Oct 2026) end to end, with no key and no
// network, and prints what the agent did.
//
//   report -> runAgent (DEMO MODE: the demo-mock provider) -> case saved -> claim PDF built
//
// It always uses the deterministic mock, even if MODEL_API_KEY happens to be set in your
// shell: this script must never spend credits, and a mock answer is never presented as
// coming from Muse (every case, trace line and PDF footer says "DEMO MODE"). The cases land
// in data/runtime/ (git-ignored), so `npm run dev` then shows them on the Cases screen.
import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAgent } from "../src/lib/agent/run-agent";
import { runtimeDir } from "../src/lib/runtime-dir";
import { loadDemoCases, provisionalDemoPhotos, type DemoCase } from "../src/lib/store/demo-cases";
import { isProvisionalDemoPhoto, resolveDemoPhoto } from "../src/lib/store/demo-photos";
import { saveCase } from "../src/lib/store/cases";
import type { CaseRecord } from "../src/lib/types";

const ROOT = process.cwd();

/** Relative to the project when the file is inside it, absolute otherwise (a temp runtime dir). */
const shown = (file: string): string => {
  const relative = path.relative(ROOT, file);
  return relative.startsWith("..") ? file : relative;
};

/**
 * A generated image for a demo photo that does not exist at all. It says "PLACEHOLDER" in
 * large letters so nobody can take it for a photo of a damaged parcel. (The mock never looks
 * at images; the PDF still needs something to embed.)
 */
async function makePlaceholder(name: string, caseTitle: string): Promise<string> {
  const { default: sharp } = await import("sharp");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <rect width="1200" height="800" fill="#d9dde3"/>
    <path d="M0 0L1200 800M1200 0L0 800" stroke="#b5bcc7" stroke-width="3"/>
    <text x="600" y="360" font-family="Helvetica, Arial, sans-serif" font-size="96" font-weight="700" text-anchor="middle" fill="#3b4350">PLACEHOLDER</text>
    <text x="600" y="440" font-family="Helvetica, Arial, sans-serif" font-size="36" text-anchor="middle" fill="#3b4350">not a photo: no demo photo for "${name}"</text>
    <text x="600" y="490" font-family="Helvetica, Arial, sans-serif" font-size="28" text-anchor="middle" fill="#3b4350">${caseTitle.replace(/[<>&"]/g, " ").slice(0, 70)}</text>
  </svg>`;
  const dir = path.join(runtimeDir(), "placeholders");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.jpg`);
  await writeFile(file, await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer());
  return file;
}

/** The photo files of a case: the demo photo when it exists, else a marked placeholder. */
async function photosFor(demo: DemoCase): Promise<{ paths: string[]; notes: string[] }> {
  const paths: string[] = [];
  const notes: string[] = [];
  for (const photo of demo.report.photos) {
    const found = resolveDemoPhoto(photo, ROOT);
    const name = path.basename(photo).replace(/\.[a-z]+$/i, "");
    if (found) {
      paths.push(path.relative(ROOT, found));
      if (isProvisionalDemoPhoto(found)) notes.push(`${name}: provisional AI-generated stand-in, not a team photo`);
    } else {
      paths.push(await makePlaceholder(name, demo.title));
      notes.push(`${name}: MISSING, generated PLACEHOLDER image used`);
    }
  }
  return { paths, notes };
}

interface Row {
  caseId: string;
  order: string;
  decision: string;
  claim: string;
  human: string;
  maxEur: string;
  left: string;
  pdf: string;
  expected: string;
  ok: boolean;
}

function checkAgainstExpectation(demo: DemoCase, c: CaseRecord): { ok: boolean; why: string[] } {
  const why: string[] = [];
  const d = c.decision;
  if (!d) return { ok: false, why: ["no decision"] };
  if (!demo.expected.acceptableDecisions.includes(d.decision)) {
    why.push(`decision ${d.decision}, expected ${demo.expected.acceptableDecisions.join("/")}`);
  }
  if (d.carrierClaim !== demo.expected.carrierClaim) {
    why.push(`carrierClaim ${d.carrierClaim}, expected ${demo.expected.carrierClaim}`);
  }
  if (d.needsHuman !== demo.expected.needsHuman) {
    why.push(`needsHuman ${d.needsHuman}, expected ${demo.expected.needsHuman}`);
  }
  if (d.carrierClaim) {
    if (!c.document) why.push("claim decided but no PDF document");
    else if (!existsSync(path.resolve(c.document.pdfPath))) why.push("PDF file is missing on disk");
  }
  return { ok: why.length === 0, why };
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

async function main(): Promise<void> {
  const now = new Date();
  console.log("[gilmend] DEMO MODE: deterministic mock provider (scripted, no image analysed, not Muse).");
  console.log("[gilmend] No network call, no key used, nothing is sent to anyone.\n");

  const rows: Row[] = [];
  const notes: string[] = [];
  const problems: string[] = [];

  for (const demo of loadDemoCases(now)) {
    const { paths, notes: photoNotes } = await photosFor(demo);
    notes.push(...photoNotes);
    const report = { ...demo.report, photos: paths };
    // A stable id: running the demo twice replaces the cases instead of piling them up.
    const caseId = `case_${demo.id}`;
    const result = await runAgent(report, { engine: "demo-mock", caseId, now, env: {} });
    await saveCase(result);

    const check = checkAgainstExpectation(demo, result);
    if (!check.ok) problems.push(`${demo.id}: ${check.why.join("; ")}`);
    const d = result.decision;
    const pdf = result.document ? path.resolve(result.document.pdfPath) : null;
    rows.push({
      caseId: demo.id,
      order: result.order?.id ?? demo.report.orderNumber,
      decision: d?.decision ?? "none",
      claim: d?.carrierClaim ? "yes" : "no",
      human: d?.needsHuman ? "yes" : "no",
      maxEur: result.claim?.eligible ? `${result.claim.maxCompensationEur.toFixed(2)} EUR` : "-",
      left: result.claim?.eligible && result.claim.daysLeft !== null ? `${result.claim.daysLeft} d` : "-",
      pdf: pdf && existsSync(pdf) ? `${shown(pdf)} (${Math.round(statSync(pdf).size / 1024)} KB)` : "-",
      expected: check.ok ? "as expected" : `MISMATCH: ${check.why.join("; ")}`,
      ok: check.ok,
    });
  }

  const columns: [keyof Row, string][] = [
    ["caseId", "case"],
    ["order", "order"],
    ["decision", "decision"],
    ["claim", "claim"],
    ["human", "human"],
    ["maxEur", "max"],
    ["left", "left"],
    ["pdf", "PDF"],
    ["expected", "vs expected"],
  ];
  const width = (key: keyof Row, title: string) => Math.max(title.length, ...rows.map((r) => String(r[key]).length));
  const widths = columns.map(([key, title]) => width(key, title));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(columns.map(([, t]) => t)));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(columns.map(([key]) => String(r[key]))));

  console.log(`\nStored in ${shown(path.join(runtimeDir(), "cases"))} (open them with "npm run dev").`);
  const provisional = provisionalDemoPhotos(ROOT);
  if (provisional.length > 0) {
    console.log(`Photos: ${provisional.length} of ${rows.length} cases use a PROVISIONAL AI-generated stand-in (data/photos/README.md).`);
  }
  for (const n of notes.filter((n) => /MISSING/.test(n))) console.log(`Photos: ${n}`);

  if (problems.length > 0) {
    console.error("\nDemo run FAILED:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${NUMBER_WORDS[rows.length] ?? rows.length} cases ended as expected (DEMO MODE).`);
  }
}

main().catch((error) => {
  console.error("[gilmend] demo failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
