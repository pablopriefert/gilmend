import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseRecord } from "@/lib/types";
import { GET as getCase } from "./cases/[id]/route";
import { POST as followUp } from "./cases/[id]/follow-up/route";
import { GET as getPdf } from "./cases/[id]/pdf/route";
import { GET as listCases } from "./cases/route";
import { GET as getFile } from "./files/route";
import { resetRateLimits } from "./_lib/rate-limit";

// The follow-up loop on a RECORDED run (the committed showcase), end to end, in DEMO MODE: the
// blurry lamp of 27 Oct 2026 ends in "ask for sharper photos"; the customer replies; round 2 is
// stored as a copy and the committed recording is never touched.

const REPO_SHOWCASE = path.join(process.cwd(), "data", "showcase");
const ID = "real_demo-3-photo-blurry";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let scratch: string;
let showcase: string;

async function fingerprint(dir: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(d: string): Promise<void> {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else hash.update(path.relative(dir, full)).update(await readFile(full));
    }
  }
  await walk(dir);
  return hash.digest("hex");
}

const reply = (id = ID, message = "Sorry, my first photo was shaky. Here is a sharper one: the glass shade is cracked all the way down.") => {
  const form = new FormData();
  form.set("message", message);
  form.set("round", "1");
  form.append("photos", new File([new Uint8Array(PNG)], "sharp.png", { type: "image/png" }));
  return followUp(new Request(`http://x/api/cases/${id}/follow-up`, { method: "POST", body: form }), ctx(id));
};
const get = async (id = ID) => ((await (await getCase(new Request("http://x"), ctx(id))).json()) as { case: CaseRecord }).case;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "dd-followup-showcase-"));
  showcase = path.join(scratch, "showcase");
  await cp(REPO_SHOWCASE, showcase, { recursive: true });
  vi.stubEnv("DAMAGE_DESK_SHOWCASE_DIR", showcase);
  vi.stubEnv("DAMAGE_DESK_RUNTIME_DIR", path.join(scratch, "runtime"));
  vi.stubEnv("MODEL_API_KEY", "");
  vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "");
  resetRateLimits();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(scratch, { recursive: true, force: true });
});

describe("a customer replies to a recorded run", () => {
  it("the recorded blurry lamp offers a reply; the other recordings do not take one", async () => {
    const before = await fingerprint(showcase);
    expect((await get()).decision?.decision).toBe("ask_more_photos");
    for (const id of ["real_demo-1-vase-broken", "real_demo-2-carton-crushed", "real_demo-6-late-report"]) {
      const res = await reply(id);
      expect(res.status, id).toBe(409);
      expect((await res.json()).error, id).toBe("follow_up_not_needed");
    }
    expect(await fingerprint(showcase)).toBe(before);
  });

  it("stores round 2 as a copy and leaves the committed recording untouched (copy-on-write)", async () => {
    const before = await fingerprint(showcase);
    const recording = JSON.parse(await readFile(path.join(showcase, "cases", `${ID}.json`), "utf8")) as CaseRecord;

    const res = await reply();
    expect(res.status).toBe(201);
    // The recording was made on Muse: with no key here, round 2 runs in the labelled mock, and says so.
    expect(await res.json()).toMatchObject({
      caseId: ID,
      round: 2,
      requestedEngine: "muse-spark-1.3",
      engine: "demo-mock",
      fellBack: true,
      fellBackReason: "no_credentials",
      decision: "reship",
    });

    const copy = await get();
    expect(copy.id).toBe(ID);
    expect(copy.engine).toBe("demo-mock");
    expect(copy.engineDetail?.short).toBe("DEMO MODE");
    expect(copy.decision).toMatchObject({ decision: "reship", carrierClaim: true });
    expect(copy.claim?.eligible).toBe(true);
    expect(copy.document?.pdfPath).toMatch(/real_demo-3-photo-blurry-round-2\.pdf$/);
    // The case is no longer the recording; round 1 still is, as a real Muse run.
    expect(copy.recorded).toBeUndefined();
    expect(copy.previousRounds).toHaveLength(1);
    expect(copy.previousRounds![0]).toMatchObject({
      number: 1,
      engine: "muse-spark-1.3",
      recorded: { recordedOn: "2026-10-27" },
      decision: { decision: "ask_more_photos" },
    });
    expect(copy.previousRounds![0].decision).toEqual(recording.decision);
    // Its trace is the recording's, line for line, then round 2.
    expect(copy.trace.slice(0, recording.trace.length)).toEqual(recording.trace);
    expect(copy.trace[recording.trace.length].step).toMatch(/^Round 2 starts/);
    // The order is the one the recording found (same delivery date), not a fresh lookup.
    expect(copy.order?.deliveredAt).toBe(recording.order?.deliveredAt);

    expect(await fingerprint(showcase)).toBe(before);
    const onDisk = JSON.parse(await readFile(path.join(showcase, "cases", `${ID}.json`), "utf8")) as CaseRecord;
    expect(onDisk.decision?.decision).toBe("ask_more_photos");
    expect(onDisk.followUps).toBeUndefined();
  });

  it("lists the copy once, among the six; the recording stays the case it was in the list's own count", async () => {
    await reply();
    const listed = ((await (await listCases()).json()) as { cases: CaseRecord[]; summary: { demoModeCases: number } });
    expect(listed.cases).toHaveLength(6);
    expect(listed.cases.filter((c) => c.id === ID)).toHaveLength(1);
    expect(listed.cases.filter((c) => c.recorded)).toHaveLength(5);
    // It is a live case now, produced in DEMO MODE: the counter counts it and labels it as such.
    expect(listed.summary.demoModeCases).toBe(1);
  });

  it("serves the new claim PDF, the new photo and the photo of round 1", async () => {
    await reply();
    const copy = await get();
    const pdf = await getPdf(new Request(`http://x/api/cases/${ID}/pdf`), ctx(ID));
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const rel = (p: string) => p.replace(/^.*[\\/]uploads[\\/]/, "uploads/").split(path.sep).join("/");
    const added = await getFile(new Request(`http://x/api/files?p=${encodeURIComponent(rel(copy.followUps![0].photos[0]))}`));
    expect(added.status).toBe(200);
    expect(added.headers.get("Content-Type")).toBe("image/png");
    const original = await getFile(new Request(`http://x/api/files?p=${encodeURIComponent("showcase/photos/lamp-blurry.webp")}`));
    expect(original.status).toBe(200);
  });

  it("a second reply to the same page is refused, and a rejected copy takes none", async () => {
    expect((await reply()).status).toBe(201);
    // Round 2 settled the case (reship + claim): nothing more to ask.
    const again = await reply();
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("follow_up_not_needed");
  });
});
