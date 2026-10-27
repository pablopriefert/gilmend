// `npm run real:follow-up`: runs ONE follow-up round of the blurry-lamp case on the real engine,
// to check the loop on the real Muse Spark 1.3 + SAM 3.1 (it spends real credits, about the price of
// one report). Round 1 is the committed recording of 27 Oct 2026 (data/showcase, never modified);
// the reply is the demo one: the sharp photo generated with Muse Image (data/photos/lamp-sharp.webp)
// and the message of the "Demo: simulate the customer's reply" button. The keys come from .env.local
// (loaded by `tsx --env-file`) and are never printed. It prints the decisions and the figures, not the
// customer's words or the photos, and it SAVES NOTHING unless asked with --save (then the case goes to
// the runtime folder like a case filed in the app, so set DAMAGE_DESK_RUNTIME_DIR to keep data/runtime clean).
import { DEMO_FOLLOW_UP } from "../src/components/demo-scenarios";
import { describeEngine, resolveEngine } from "../src/lib/config";
import { resumeAgent } from "../src/lib/agent/run-agent";
import { followUpAvailability } from "../src/lib/rounds";
import { getShowcaseCase } from "../src/lib/showcase/showcase";
import { saveCase } from "../src/lib/store/cases";
import type { Engine, FollowUp } from "../src/lib/types";

const CASE_ID = "real_demo-3-photo-blurry";

async function main(): Promise<void> {
  const requested = (process.argv.find((a) => ["muse-spark-1.3", "open-weights", "openrouter"].includes(a)) ?? "muse-spark-1.3") as Engine;
  // resumeAgent would quietly fall back to the labelled mock without credentials: here that would hide
  // the very thing being tested, so refuse instead.
  if (resolveEngine(requested, process.env) !== requested) {
    console.error(`${requested} is not configured in .env.local (see .env.example): nothing was sent.`);
    process.exit(1);
  }
  const recorded = await getShowcaseCase(CASE_ID);
  if (!recorded) {
    console.error(`The recorded case ${CASE_ID} was not found in data/showcase.`);
    process.exit(1);
  }
  const availability = followUpAvailability(recorded);
  if (!availability.available) {
    console.error(`The case takes no follow-up (${availability.reason}).`);
    process.exit(1);
  }

  const followUp: FollowUp = {
    id: "real-follow-up-1",
    receivedAt: new Date().toISOString(),
    message: DEMO_FOLLOW_UP.message,
    photos: ["data/photos/lamp-sharp.webp"],
    simulated: true,
  };
  console.log(`[gilmend] REAL FOLLOW-UP on ${describeEngine(requested).label}: round ${availability.nextRound} of ${CASE_ID} (round 1 = the recording of ${recorded.recorded?.recordedOn})`);
  console.log(`round 1: ${recorded.decision?.decision} | confidence ${recorded.decision?.confidence} | photo quality ${recorded.assessment?.photoQuality} | order ${recorded.order?.id}`);

  const started = Date.now();
  const result = await resumeAgent(recorded, followUp, { engine: requested, env: process.env });
  const seconds = Math.round((Date.now() - started) / 1000);

  console.log(`engine: ${result.engine} (${result.engineDetail?.model}) | status: ${result.status} | ${seconds} s`);
  console.log(`assessment: ${result.assessment ? `${result.assessment.damageType}, severity ${result.assessment.severity}, photo quality ${result.assessment.photoQuality}, packaging ${result.assessment.packagingAdequate}` : "none"}`);
  console.log(`claim: ${result.claim ? `eligible ${result.claim.eligible}, up to ${result.claim.maxCompensationEur} EUR, deadline ${result.claim.claimDeadline}` : "none"}`);
  console.log(`decision (round ${result.followUps?.length ? result.followUps.length + 1 : 1}): ${result.decision?.decision} | carrier claim ${result.decision?.carrierClaim} | confidence ${result.decision?.confidence} | needs a human ${result.decision?.needsHuman}`);
  console.log(`evidence: ${result.evidence.map((e) => `${e.method}${e.annotatedPhoto ? " (annotated)" : ""}`).join(", ") || "none"}`);
  console.log(`document: ${result.document ? "claim PDF built" : "none"}`);
  console.log("round 2 trace (step names only):");
  for (const step of result.trace.filter((s) => s.round === 2)) console.log(`  - ${step.step.slice(0, 110)}${step.tool ? ` [${step.tool}]` : ""}`);
  console.log(`round 1 kept: ${result.previousRounds?.[0]?.decision?.decision} (${result.previousRounds?.[0]?.engine}, recorded ${result.previousRounds?.[0]?.recorded?.recordedOn})`);

  if (process.argv.includes("--save")) {
    await saveCase(result);
    console.log(`saved as ${result.id} in the runtime folder.`);
  } else {
    console.log("not saved (add --save to store it).");
  }
}

main().catch((err) => {
  console.error("run failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
