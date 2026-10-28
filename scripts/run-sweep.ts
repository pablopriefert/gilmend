// `npm run sweep`: runs ONE morning sweep on the real engine (Muse Spark 1.3), against a THROWAWAY
// store seeded with the six recorded showcase cases copied as live cases. It makes at most six short
// text calls (one briefing, up to five nudges, no image: a few cents) and prints the plan, the
// briefing, the nudge drafts and what it cost in calls and tokens. The key comes from .env.local
// (loaded by `tsx --env-file`) and is never printed. Nothing is written to data/runtime/: the store
// lives in a temporary folder that is removed at the end. The six cases are fictitious.
//
// To show a nudge, one copy is changed in the temporary store: the blurry-lamp request is marked
// approved 60 hours ago, as if the merchant had clicked "Approve" three days earlier. That is a
// SIMULATED click, said again in the output; the recordings themselves are never touched.
//
//   npx tsx --env-file=.env.local scripts/run-sweep.ts [--no-simulated-approval]
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeEngine, resolveEngine } from "../src/lib/config";
import { listShowcaseCases } from "../src/lib/showcase/showcase";
import type { CaseRecord } from "../src/lib/types";

async function main(): Promise<void> {
  // runSweep would quietly fall back to the labelled script without a key: here that would hide
  // the very thing being tested, so refuse instead.
  if (resolveEngine("muse-spark-1.3", process.env) !== "muse-spark-1.3") {
    console.error("MODEL_API_KEY is not set (see .env.example): nothing was sent.");
    process.exit(1);
  }
  const recorded = await listShowcaseCases();
  if (recorded.length === 0) {
    console.error("No recorded case found in data/showcase.");
    process.exit(1);
  }

  // From here on every store call goes to a temporary folder, and the showcase layer is switched
  // off, so the copies below are the only cases the sweep sees.
  const tmp = mkdtempSync(path.join(os.tmpdir(), "gilmend-sweep-"));
  process.env.DAMAGE_DESK_RUNTIME_DIR = tmp;
  process.env.DAMAGE_DESK_SHOWCASE_DIR = path.join(tmp, "no-showcase");
  try {
    const { saveCase } = await import("../src/lib/store/cases");
    const { runSweep } = await import("../src/lib/sweep/run");
    const now = new Date();
    const simulate = !process.argv.includes("--no-simulated-approval");

    for (const original of recorded) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `recorded` is dropped: this is a live copy
      const { recorded: _recorded, ...live } = original;
      let copy: CaseRecord = live as CaseRecord;
      if (simulate && copy.decision?.decision === "ask_more_photos") {
        const approvedAt = new Date(now.getTime() - 60 * 3_600_000).toISOString();
        copy = {
          ...copy,
          status: "approved",
          trace: [...copy.trace, { step: "Merchant approved the case. Ready to send; nothing was sent.", at: approvedAt }],
          updatedAt: approvedAt,
        };
        console.log(`[sweep] SIMULATED: ${copy.order?.id ?? copy.id} marked approved 60 h ago in the temporary copy.`);
      }
      await saveCase(copy);
    }
    console.log(`[sweep] ${recorded.length} showcase cases copied as live cases into a temporary store.`);
    console.log(`[sweep] REAL SWEEP on ${describeEngine("muse-spark-1.3").label}, ${now.toISOString()}`);

    const started = Date.now();
    const { sweep, stored } = await runSweep({ trigger: "manual", now, env: process.env });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    console.log(`engine: ${sweep.engine} (${sweep.engineDetail.label}) | fell back: ${sweep.fellBackReason ?? "no"} | stored: ${stored} | ${seconds} s`);
    console.log(`model calls: ${JSON.stringify(sweep.modelCalls)} | reused texts: ${sweep.reusedTexts} | usage: ${JSON.stringify(sweep.usage)}`);
    console.log(`counts: ${JSON.stringify(sweep.counts)} | could still be claimed (at most): ${sweep.moneyAtStakeEur.toFixed(2)} EUR`);
    console.log(`briefing [${sweep.briefing.source}${sweep.briefing.note ? `: ${sweep.briefing.note}` : ""}]:\n  ${sweep.briefing.text}`);
    console.log("plan:");
    for (const item of sweep.items) {
      const deadline = item.deadline ? `${item.deadline.kind} in ${item.deadline.hoursLeft.toFixed(1)} h (${item.deadline.at})` : "no deadline";
      console.log(`  ${item.rank}. ${item.orderId} ${item.carrierLabel ?? "?"} | ${item.action} | ${deadline} | ${item.amountEur.toFixed(2)} EUR`);
      for (const r of item.reasons) console.log(`       - [${r.kind}] ${r.text}`);
      if (item.nudge) console.log(`       nudge [${item.nudge.source}${item.nudge.note ? `: ${item.nudge.note}` : ""}]:\n         ${item.nudge.text.replace(/\n/g, "\n         ")}`);
    }

    // A second sweep right away must cost nothing: today's texts are reused.
    const again = await runSweep({ trigger: "manual", now: new Date(), env: process.env });
    console.log(`second sweep: model calls ${again.sweep.modelCalls.total}, reused texts ${again.sweep.reusedTexts}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("sweep failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
