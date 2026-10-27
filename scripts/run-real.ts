// `npm run real -- <case-id> [engine]`: runs ONE demo case through a real engine, unlike
// `npm run demo`, which never leaves the machine. The engine is muse-spark-1.3 (Meta Model API,
// the default), open-weights (Baseten or Modal, see .env.example) or openrouter (cheap test
// engine). It spends real credits (about $0.04 a run on Muse Spark 1.3), so it runs a single case
// and prints what it did. The keys come from .env.local (loaded by `tsx --env-file`); they are
// never printed.
import path from "node:path";
import { runAgent } from "../src/lib/agent/run-agent";
import { loadDemoCases } from "../src/lib/store/demo-cases";
import { resolveDemoPhoto } from "../src/lib/store/demo-photos";
import { saveCase } from "../src/lib/store/cases";
import { describeEngine, resolveEngine } from "../src/lib/config";
import type { Engine } from "../src/lib/types";

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
  const requested = (process.argv[3] ?? "muse-spark-1.3") as Engine;
  if (!["muse-spark-1.3", "open-weights", "openrouter"].includes(requested)) {
    console.error(`Unknown engine "${requested}". Use muse-spark-1.3, open-weights or openrouter.`);
    process.exit(1);
  }
  // runAgent would quietly fall back to the labelled mock without credentials: here that would
  // hide the very thing being tested, so refuse instead.
  if (resolveEngine(requested, process.env) !== requested) {
    console.error(`${requested} is not configured in .env.local (see .env.example): nothing was sent.`);
    process.exit(1);
  }

  const photos: string[] = [];
  for (const photo of demo.report.photos) {
    const found = resolveDemoPhoto(photo, ROOT);
    if (found) photos.push(path.relative(ROOT, found));
  }
  console.log(`[gilmend] REAL RUN on ${describeEngine(requested).label} — case ${demo.id}, ${photos.length} photo(s)`);

  const started = Date.now();
  const result = await runAgent({ ...demo.report, photos }, {
    engine: requested,
    caseId: `real_${demo.id}`,
    now,
    env: process.env,
  });
  await saveCase(result);

  console.log(`engine: ${result.engine} (${result.engineDetail?.model}) | status: ${result.status} | ${Math.round((Date.now() - started) / 1000)} s`);
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
