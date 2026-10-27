import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followUpAvailability, getRounds } from "@/lib/rounds";
import type { CaseRecord } from "@/lib/types";
import { GET as getCase } from "./cases/[id]/route";
import { POST as followUp } from "./cases/[id]/follow-up/route";
import { GET as getPdf } from "./cases/[id]/pdf/route";
import { GET as listCases } from "./cases/route";
import { GET as getFile } from "./files/route";
import { resetRateLimits } from "./_lib/rate-limit";

// The follow-up loop on a RECORDED run (the committed showcase), end to end, in DEMO MODE: the
// blurry lamp of 27 Oct 2026 ends in "ask for sharper photos"; the customer replies; round 2 is
// saved as a NEW case (a fork) that starts from a copy of the recording, and the recording itself
// stays exactly what it was, for every visitor, so the demo can be played again. (Review of 28 Oct
// 2026: the round used to be saved under the recording's own id, which hid the recording for good.)

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

const DEMO_PHOTO = () => readFileSync(path.join(REPO_SHOWCASE, "..", "photos", "lamp-sharp.webp"));
const FORK_ID = new RegExp(`^${ID}-followup-[0-9a-f]{8}$`);

const reply = (
  id = ID,
  message = "Sorry, my first photo was shaky. Here is a sharper one: the glass shade is cracked all the way down.",
  photo?: File,
) => {
  const form = new FormData();
  form.set("message", message);
  form.set("round", "1");
  form.append("photos", photo ?? new File([new Uint8Array(PNG)], "sharp.png", { type: "image/png" }));
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

  it("saves round 2 as a NEW case that starts from a copy of the recording, and leaves the recording untouched", async () => {
    const before = await fingerprint(showcase);
    const recording = JSON.parse(await readFile(path.join(showcase, "cases", `${ID}.json`), "utf8")) as CaseRecord;

    const res = await reply();
    expect(res.status).toBe(201);
    const body = await res.json();
    // The recording was made on Muse: with no key here, round 2 runs in the labelled mock, and says so.
    expect(body).toMatchObject({
      forkedFrom: ID,
      round: 2,
      requestedEngine: "muse-spark-1.3",
      engine: "demo-mock",
      fellBack: true,
      fellBackReason: "no_credentials",
      decision: "reship",
    });
    // The answer names the NEW case: the page opens it.
    expect(body.caseId).toMatch(FORK_ID);

    const fork = await get(body.caseId);
    expect(fork.id).toBe(body.caseId);
    expect(fork.followedFrom).toBe(ID);
    expect(fork.engine).toBe("demo-mock");
    expect(fork.engineDetail?.short).toBe("DEMO MODE");
    expect(fork.decision).toMatchObject({ decision: "reship", carrierClaim: true });
    expect(fork.claim?.eligible).toBe(true);
    expect(fork.document?.pdfPath).toMatch(new RegExp(`${body.caseId}-round-2\\.pdf$`));
    // The fork is no longer the recording; round 1 of it still is, as a real Muse run.
    expect(fork.recorded).toBeUndefined();
    expect(fork.previousRounds).toHaveLength(1);
    expect(fork.previousRounds![0]).toMatchObject({
      number: 1,
      engine: "muse-spark-1.3",
      recorded: { recordedOn: "2026-10-27" },
      decision: { decision: "ask_more_photos" },
    });
    expect(fork.previousRounds![0].decision).toEqual(recording.decision);
    expect(getRounds(fork)[0].outcome?.recorded).toEqual({ recordedOn: "2026-10-27" });
    // Its trace is the recording's, line for line, then round 2 (which says it continues a recording).
    expect(fork.trace.slice(0, recording.trace.length)).toEqual(recording.trace);
    expect(fork.trace[recording.trace.length].step).toMatch(/^Round 2 starts/);
    expect(fork.trace[recording.trace.length + 1].step).toMatch(new RegExp(`continues the recorded run ${ID}`));
    // The order is the one the recording found (same delivery date), not a fresh lookup.
    expect(fork.order?.deliveredAt).toBe(recording.order?.deliveredAt);

    expect(await fingerprint(showcase)).toBe(before);
  });

  it("leaves the recording as it was for every visitor after the demo sequence: round 1, recorded, and still asking for a reply", async () => {
    // The sequence of the demo video, with the simulated reply of the button (its photo, byte for byte).
    const demoPhoto = new File([new Uint8Array(DEMO_PHOTO())], "lamp-sharp.webp", { type: "image/webp" });
    const res = await reply(ID, "Sorry, here is a sharper photo.", demoPhoto);
    expect(res.status).toBe(201);
    expect((await res.json()).simulated).toBe(true);

    // The case the next visitor opens: the recording, untouched.
    const recording = await get(ID);
    expect(recording.recorded).toEqual({ recordedOn: "2026-10-27" });
    expect(recording.followUps).toBeUndefined();
    expect(recording.previousRounds).toBeUndefined();
    expect(recording.followedFrom).toBeUndefined();
    expect(recording.decision?.decision).toBe("ask_more_photos");
    expect(recording.engine).toBe("muse-spark-1.3");
    // So "The customer replied" and the demo button are still offered, and the list still shows it recorded.
    expect(followUpAvailability(recording)).toMatchObject({ available: true, missing: ["photos"], nextRound: 2 });
    const listed = ((await (await listCases()).json()) as { cases: CaseRecord[] }).cases;
    expect(listed.find((c) => c.id === ID)?.recorded).toBeDefined();
    expect(listed.filter((c) => c.recorded)).toHaveLength(6);

    // And the sequence can be played again, any number of times: each reply is its own case.
    const second = await reply(ID, "Sorry, here is a sharper photo.", new File([new Uint8Array(DEMO_PHOTO())], "lamp-sharp.webp", { type: "image/webp" }));
    expect(second.status).toBe(201);
    const secondId = (await second.json()).caseId as string;
    expect(secondId).toMatch(FORK_ID);
    expect(listed.map((c) => c.id)).not.toContain(secondId);
    expect(((await (await listCases()).json()) as { cases: CaseRecord[] }).cases).toHaveLength(listed.length + 1);
    expect(followUpAvailability(await get(ID))).toMatchObject({ available: true });
  });

  it("keeps a rehearsal out of the money counter and says so, while the recording keeps its own figure", async () => {
    const demoPhoto = new File([new Uint8Array(DEMO_PHOTO())], "lamp-sharp.webp", { type: "image/webp" });
    const forkId = (await (await reply(ID, "Sorry, here is a sharper photo.", demoPhoto)).json()).caseId as string;
    const fork = await get(forkId);
    expect(fork.followUps?.[0].simulated).toBe(true);
    expect(fork.claim?.eligible).toBe(true);
    expect(fork.claim?.maxCompensationEur).toBeGreaterThan(0);

    const { summary } = (await (await listCases()).json()) as { summary: { recoverableThisMonthEur: number; simulatedReplyCases: number; claimsDueThisWeek: number; dueCaseIds: string[] } };
    expect(summary.simulatedReplyCases).toBe(1);
    expect(summary.dueCaseIds).not.toContain(forkId);
    expect(summary.recoverableThisMonthEur).toBe(0);
  });

  it("lists the fork next to the six recordings, which are all still there", async () => {
    const forkId = (await (await reply()).json()).caseId as string;
    const listed = ((await (await listCases()).json()) as { cases: CaseRecord[]; summary: { demoModeCases: number } });
    expect(listed.cases).toHaveLength(7);
    expect(listed.cases.filter((c) => c.id === ID)).toHaveLength(1);
    expect(listed.cases.filter((c) => c.id === forkId)).toHaveLength(1);
    expect(listed.cases.filter((c) => c.recorded)).toHaveLength(6);
    // It is a live case, produced in DEMO MODE (a reply that is not the demo photo is real): the counter labels it.
    expect(listed.summary.demoModeCases).toBe(1);
  });

  it("serves the new claim PDF, the new photo and the photo of round 1", async () => {
    const forkId = (await (await reply()).json()).caseId as string;
    const fork = await get(forkId);
    const pdf = await getPdf(new Request(`http://x/api/cases/${forkId}/pdf`), ctx(forkId));
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const rel = (p: string) => p.replace(/^.*[\\/]uploads[\\/]/, "uploads/").split(path.sep).join("/");
    const added = await getFile(new Request(`http://x/api/files?p=${encodeURIComponent(rel(fork.followUps![0].photos[0]))}`));
    expect(added.status).toBe(200);
    expect(added.headers.get("Content-Type")).toBe("image/png");
    const original = await getFile(new Request(`http://x/api/files?p=${encodeURIComponent("showcase/photos/lamp-blurry.webp")}`));
    expect(original.status).toBe(200);
  });

  it("a second reply on the fork's own page is refused once round 2 settled it; the recording still takes one", async () => {
    const forkId = (await (await reply()).json()).caseId as string;
    // Round 2 settled the fork (reship + claim): nothing more to ask on it.
    const again = await reply(forkId);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("follow_up_not_needed");
    expect((await reply()).status).toBe(201);
  });
});
