import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
let runtime: string;

beforeAll(async () => {
  runtime = await mkdtemp(path.join(os.tmpdir(), "dd-demo-script-"));
});
afterAll(async () => {
  await rm(runtime, { recursive: true, force: true });
});

describe("npm run demo (scripts/demo.ts)", () => {
  it("runs the seven demo cases end to end in demo mode, stores them and builds their PDFs", async () => {
    const { stdout, stderr } = await run("npx", ["tsx", "scripts/demo.ts"], {
      cwd: process.cwd(),
      timeout: 90_000,
      env: {
        ...process.env,
        DAMAGE_DESK_RUNTIME_DIR: runtime,
        // A key in the environment must NOT be used: the script is always mock-only. A fake
        // value would make any real call fail loudly instead of spending credits.
        MODEL_API_KEY: "fake-key-the-demo-must-never-use",
        OPEN_WEIGHTS_BASE_URL: "",
        OPEN_WEIGHTS_MODEL: "",
      },
    });

    expect(stdout).toContain("DEMO MODE");
    expect(stdout).toContain("All seven cases ended as expected");
    for (const id of [
      "demo-1-vase-broken",
      "demo-2-carton-crushed",
      "demo-3-photo-blurry",
      "demo-4-opened-missing",
      "demo-5-expensive-escalation",
      "demo-6-late-report",
      "demo-7-german-carafe",
    ]) {
      expect(stdout).toContain(id);
    }
    expect(stderr).not.toMatch(/Error|FAILED/);

    // The cases are stored, and the four claims have their PDF.
    expect((await readdir(path.join(runtime, "cases"))).filter((f) => f.endsWith(".json"))).toHaveLength(7);
    expect((await readdir(path.join(runtime, "claims"))).sort()).toEqual([
      "case_demo-1-vase-broken.pdf",
      "case_demo-4-opened-missing.pdf",
      "case_demo-5-expensive-escalation.pdf",
      "case_demo-7-german-carafe.pdf",
    ]);
  }, 120_000);
});
