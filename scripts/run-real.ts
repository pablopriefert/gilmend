// `npm run real -- <case-id>`: runs ONE demo case through the real Muse Spark 1.3 (Meta Model
// API), unlike `npm run demo`, which never leaves the machine. It spends real credits (about
// $0.04 a run), so it runs a single case and prints what it did. The key comes from .env.local
// (loaded by `tsx --env-file`); it is never printed.
import path from "node:path";
import { runAgent } from "../src/lib/agent/run-agent";
import { loadDemoCases } from "../src/lib/store/demo-cases";
import { resolveDemoPhoto } from "../src/lib/store/demo-photos";
import { saveCase } from "../src/lib/store/cases";

const ROOT = process.cwd();

async function main(): Promise<void> {
  const wanted = process.argv[2];
  const now = new Date();
  const cases = loadDemoCases(now);
  const demo = cases.find((c) => c.id === wanted);
  if (!demo) {
    console.error(`Usage: npm run real -- <case-id>. Known cases: ${cases.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
  if (!process.env.MODEL_API_KEY) {
    console.error("MODEL_API_KEY is missing (.env.local): nothing was sent.");
    process.exit(1);
  }

  const photos: string[] = [];
  for (const photo of demo.report.photos) {
    const found = resolveDemoPhoto(photo, ROOT);
    if (found) photos.push(path.relative(ROOT, found));
  }
  console.log(`[damage-desk] REAL RUN on muse-spark-1.3 (Meta Model API) — case ${demo.id}, ${photos.length} photo(s)`);

  const started = Date.now();
  const result = await runAgent({ ...demo.report, photos }, {
    engine: "muse-spark-1.3",
    caseId: `real_${demo.id}`,
    now,
    env: process.env,
  });
  await saveCase(result);

  console.log(`engine: ${result.engine} | status: ${result.status} | ${Math.round((Date.now() - started) / 1000)} s`);
  console.log("assessment:", JSON.stringify(result.assessment));
  console.log("claim:", JSON.stringify(result.claim));
  console.log("decision:", JSON.stringify(result.decision, null, 2));
  console.log("evidence:", result.evidence.map((e) => `${e.method}${e.annotatedPhoto ? " (annotated)" : ""}: ${e.note}`).join(" | "));
  console.log("document:", result.document?.pdfPath ?? "none");
  console.log("trace:");
  for (const step of result.trace) console.log(`  - ${step.step}${step.tool ? ` [${step.tool}]` : ""}`);
}

main().catch((err) => {
  console.error("run failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
