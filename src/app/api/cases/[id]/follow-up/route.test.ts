import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase } from "@/components/fixtures";
import { runAgent } from "@/lib/agent/run-agent";
import { getCase, saveCase, updateCase } from "@/lib/store/cases";
import type { CaseRecord, Engine, FollowUp } from "@/lib/types";
import { resetRateLimits } from "../../../_lib/rate-limit";

type ResumeArgs = [CaseRecord, FollowUp, { engine: Engine }];

// The real resumeAgent by default (in DEMO MODE: no key in these tests); a test that needs to
// watch or control the run puts a hook here.
const control = vi.hoisted(() => ({ hook: null as null | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock("@/lib/agent/run-agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent/run-agent")>("@/lib/agent/run-agent");
  return {
    ...actual,
    resumeAgent: (...a: Parameters<typeof actual.resumeAgent>) =>
      control.hook ? (control.hook(...a) as ReturnType<typeof actual.resumeAgent>) : actual.resumeAgent(...a),
  };
});

import { POST } from "./route";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const ID = "case_lamp";

const file = (bytes: Uint8Array | Buffer, name = "photo.png", type = "image/png") =>
  new File([new Uint8Array(bytes)], name, { type });

function reply(
  over: { fields?: Record<string, string>; photos?: File[]; headers?: Record<string, string>; id?: string } = {},
): [Request, { params: Promise<{ id: string }> }] {
  const form = new FormData();
  const fields = { message: "Here is a sharper photo, the glass is cracked.", ...over.fields };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const p of over.photos ?? [file(PNG)]) form.append("photos", p);
  const id = over.id ?? ID;
  return [
    new Request(`http://localhost/api/cases/${id}/follow-up`, { method: "POST", body: form, headers: over.headers }),
    { params: Promise.resolve({ id }) },
  ];
}
const post = (over?: Parameters<typeof reply>[0]) => POST(...reply(over));

/** A real round 1 in DEMO MODE: the blurry lamp, which ends in "ask for sharper photos". */
async function seedLamp(over: Partial<CaseRecord> = {}): Promise<CaseRecord> {
  const first = await runAgent(
    {
      id: "lamp-1",
      receivedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      customerEmail: "ines.moreau@example.org",
      orderNumber: "#1003",
      message: "My lamp is damaged, I think the glass is cracked. Here is a photo.",
      photos: ["data/photos/lamp-blurry.webp"],
      language: "en",
    },
    { engine: "demo-mock", caseId: ID },
  );
  return saveCase({ ...first, ...over });
}

let runtimeRoot: string;

beforeEach(async () => {
  runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "dd-followup-"));
  vi.stubEnv("DAMAGE_DESK_RUNTIME_DIR", runtimeRoot);
  for (const key of ["MODEL_API_KEY", "OPEN_WEIGHTS_BASE_URL", "OPEN_WEIGHTS_MODEL", "OPEN_WEIGHTS_PROVIDER", "BASETEN_API_KEY", "OPENROUTER_API_KEY", "DAMAGE_DESK_ACCESS_CODE", "DAMAGE_DESK_REAL_RUNS_PER_DAY"]) {
    vi.stubEnv(key, "");
  }
  resetRateLimits();
  control.hook = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(runtimeRoot, { recursive: true, force: true });
});

describe("POST /api/cases/[id]/follow-up: the customer replied", () => {
  it("stores the photos, resumes the same case, saves round 2 and answers with the new decision", async () => {
    const first = await seedLamp();
    expect(first.decision?.decision).toBe("ask_more_photos");

    const res = await post({ photos: [file(PNG), file(JPEG, "b.jpg", "image/jpeg")], fields: { round: "1" } });
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      caseId: ID,
      round: 2,
      status: "needs_review",
      engine: "demo-mock",
      requestedEngine: "demo-mock",
      decision: "reship",
      fellBack: false,
      fellBackReason: null,
      simulated: false,
    });

    const saved = (await getCase(ID))!;
    expect(saved.followUps).toHaveLength(1);
    const [followUp] = saved.followUps!;
    expect(followUp.message).toBe("Here is a sharper photo, the glass is cracked.");
    expect(followUp.photos).toHaveLength(2);
    expect(followUp.simulated).toBeUndefined();
    // Stored under the runtime folder, with the real extension read from the bytes.
    for (const [i, photo] of followUp.photos.entries()) {
      expect(existsSync(photo)).toBe(true);
      expect(photo).toMatch(i === 0 ? /uploads[\\/].+[\\/]photo-1\.png$/ : /uploads[\\/].+[\\/]photo-2\.jpg$/);
    }
    // The same case, a new round: round 1 kept, the report untouched.
    expect(saved.previousRounds).toHaveLength(1);
    expect(saved.previousRounds![0].decision?.decision).toBe("ask_more_photos");
    expect(saved.report).toEqual(first.report);
    expect(saved.decision).toMatchObject({ decision: "reship", carrierClaim: true });
    expect(saved.trace.at(-1)?.round).toBe(2);
    expect(saved.engine).toBe("demo-mock");
  });

  it("takes a reply that is only photos, or only words", async () => {
    await seedLamp();
    expect((await post({ fields: { message: "" }, photos: [file(PNG)] })).status).toBe(201);
    await seedLamp();
    resetRateLimits();
    expect((await post({ fields: { message: "I will send more tomorrow." }, photos: [] })).status).toBe(201);
  });

  it("answers 404 for an unknown case and for an id that is not an id", async () => {
    expect((await post({ id: "case_nope" })).status).toBe(404);
    expect((await post({ id: "../etc" })).status).toBe(404);
  });
});

describe("POST /api/cases/[id]/follow-up: who may add a reply", () => {
  it("needs the access code on a public deployment, and nothing is stored without it", async () => {
    await seedLamp();
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "demo-code-16-chars-or-more");
    const refused = await post();
    expect(refused.status).toBe(401);
    expect((await refused.json()).error).toBe("access_code_required");
    expect((await post({ headers: { "x-access-code": "wrong" } })).status).toBe(401);
    expect(await readdir(runtimeRoot).then((l) => l.includes("uploads"))).toBe(false);
    expect((await getCase(ID))?.followUps).toBeUndefined();

    const ok = await post({ headers: { "x-access-code": "demo-code-16-chars-or-more" } });
    expect(ok.status).toBe(201);
    expect((await getCase(ID))?.followUps).toHaveLength(1);
  });

  it("locks a client out after too many wrong codes (429), even for the right one", async () => {
    await seedLamp();
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "demo-code-16-chars-or-more");
    for (let i = 0; i < 10; i++) expect((await post({ headers: { "x-access-code": `wrong-${i}` } })).status).toBe(401);
    const locked = await post({ headers: { "x-access-code": "demo-code-16-chars-or-more" } });
    expect(locked.status).toBe(429);
    expect(locked.headers.get("Retry-After")).toBeTruthy();
  });

  it("is rate limited per client, like a report", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await post({ id: "case_nope" })).status;
    expect(last).toBe(429);
  });

  it("refuses a body that is too large before reading it", async () => {
    await seedLamp();
    const [request, ctx] = reply();
    const big = new Request(request.url, { method: "POST", body: await request.arrayBuffer(), headers: { "content-length": String(40 * 1024 * 1024), "content-type": request.headers.get("content-type")! } });
    expect((await POST(big, ctx)).status).toBe(413);
  });
});

describe("POST /api/cases/[id]/follow-up: when a reply makes sense", () => {
  it("refuses a case that asked the customer for nothing (409 follow_up_not_needed)", async () => {
    await saveCase(makeCase({ id: ID }));
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("follow_up_not_needed");
  });

  it("refuses a case with no decision, a rejected case, and a case that already holds the most replies", async () => {
    await seedLamp({ status: "new", decision: null });
    expect((await (await post()).json()).error).toBe("follow_up_no_decision");

    await seedLamp({ status: "rejected" });
    expect((await (await post()).json()).error).toBe("follow_up_closed");

    const reply1: FollowUp = { id: "a", receivedAt: "2026-10-28T10:00:00.000Z", message: "x", photos: [] };
    await seedLamp({ followUps: [reply1, { ...reply1, id: "b" }, { ...reply1, id: "c" }] });
    const limit = await post();
    expect(limit.status).toBe(409);
    expect((await limit.json()).error).toBe("follow_up_limit");
  });

  it("takes a reply on a case whose request for photos was already approved", async () => {
    await seedLamp({ status: "approved" });
    const res = await post();
    expect(res.status).toBe(201);
    // The new round is to be reviewed: back to needs_review, and the approved request is round 1's.
    expect((await getCase(ID))?.status).toBe("needs_review");
    expect((await getCase(ID))?.previousRounds?.[0].status).toBe("approved");
  });

  it("refuses a stale page: the round it saw is not the round the case is in (no second run)", async () => {
    await seedLamp();
    expect((await post({ fields: { round: "1" } })).status).toBe(201);
    // The case is in round 2 now (and settled): a second click from the old page.
    await saveCase({ ...(await getCase(ID))!, decision: { ...(await getCase(ID))!.decision!, decision: "ask_more_photos", needsHuman: true } });
    const stale = await post({ fields: { round: "1" } });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("stale_round");
    expect((await getCase(ID))?.followUps).toHaveLength(1);
  });

  it("refuses a second reply while the first is still running, and answers the first normally", async () => {
    await seedLamp();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = vi.fn();
    const actual = await vi.importActual<typeof import("@/lib/agent/run-agent")>("@/lib/agent/run-agent");
    control.hook = async (...a) => {
      started();
      await gate;
      return actual.resumeAgent(...(a as Parameters<typeof actual.resumeAgent>));
    };
    const first = post();
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    const second = await post();
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("follow_up_running");
    release();
    expect((await first).status).toBe(201);
    expect(started).toHaveBeenCalledTimes(1);
    expect((await getCase(ID))?.followUps).toHaveLength(1);
  });

  it("does not overwrite a change made while the agent was working", async () => {
    await seedLamp();
    const actual = await vi.importActual<typeof import("@/lib/agent/run-agent")>("@/lib/agent/run-agent");
    control.hook = async (...a) => {
      const result = await actual.resumeAgent(...(a as Parameters<typeof actual.resumeAgent>));
      // The merchant approves the case in another tab while the agent works.
      await updateCase(ID, { status: "approved" });
      return result;
    };
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("case_changed");
    const kept = (await getCase(ID))!;
    expect(kept.status).toBe("approved");
    expect(kept.followUps).toBeUndefined();
  });

  it("leaves the case as it was when the run itself blows up (502), so the merchant can try again", async () => {
    await seedLamp();
    control.hook = async () => {
      throw new Error("boom");
    };
    const res = await post();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("agent_failed");
    expect((await getCase(ID))?.followUps).toBeUndefined();
    expect((await getCase(ID))?.decision?.decision).toBe("ask_more_photos");
  });
});

describe("POST /api/cases/[id]/follow-up: what a reply may contain", () => {
  beforeEach(async () => {
    await seedLamp();
  });

  const fields = async (res: Response) => ((await res.json()) as { fields: Record<string, string> }).fields;

  it("needs words or at least one photo", async () => {
    const res = await post({ fields: { message: "  " }, photos: [] });
    expect(res.status).toBe(400);
    expect((await fields(res)).message).toBe("Add what the customer wrote, or at least one photo.");
  });

  it("takes at most 3 photos, only JPEG, PNG or WebP, and checks the real bytes, not the claimed type", async () => {
    const four = await post({ photos: [file(PNG), file(PNG), file(PNG), file(PNG)] });
    expect((await fields(four)).photos).toBe("You can add up to 3 photos.");
    const pdf = await post({ photos: [file(PNG, "doc.pdf", "application/pdf")] });
    expect((await fields(pdf)).photos).toMatch(/not a JPEG, PNG or WebP image/);
    const fake = await post({ photos: [file(new TextEncoder().encode("<script>alert(1)</script>"), "evil.png", "image/png")] });
    expect(fake.status).toBe(400);
    expect((await fields(fake)).photos).toMatch(/not a real JPEG, PNG or WebP image/);
    const huge = await post({ photos: [file(new Uint8Array(8 * 1024 * 1024 + 1), "huge.png")] });
    expect((await fields(huge)).photos).toMatch(/larger than 8 MB/);
    expect((await getCase(ID))?.followUps).toBeUndefined();
  });

  it("caps the message", async () => {
    const res = await post({ fields: { message: "x".repeat(2001) } });
    expect((await fields(res)).message).toMatch(/too long \(max 2000 characters\)/);
  });

  it("does not let a reply change the order of a case whose order was found", async () => {
    const res = await post({ fields: { orderNumber: "#1001" } });
    expect(res.status).toBe(400);
    expect((await fields(res)).orderNumber).toMatch(/already has its order/);
  });

  it("rejects a body that is not multipart", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ message: "hi" }), headers: { "content-type": "application/json" } }), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_form");
  });
});

describe("POST /api/cases/[id]/follow-up: a corrected order number", () => {
  it("is accepted when the case has no order yet, and the agent looks it up", async () => {
    const lost = await runAgent(
      {
        id: "lost-1",
        receivedAt: new Date(Date.now() - 3_600_000).toISOString(),
        customerEmail: "camille.laurent@example.com",
        orderNumber: "#9999",
        message: "My vase arrived broken.",
        photos: ["data/photos/vase-broken.webp"],
        language: "en",
      },
      { engine: "demo-mock", caseId: ID },
    );
    expect(lost.order).toBeNull();
    await saveCase(lost);

    const res = await post({ fields: { orderNumber: "#1001", message: "Sorry, the order is #1001." }, photos: [] });
    expect(res.status).toBe(201);
    const saved = (await getCase(ID))!;
    expect(saved.followUps?.[0].orderNumber).toBe("#1001");
    expect(saved.order?.id).toBe("#1001");
    expect(saved.report.orderNumber).toBe("#9999");
    expect(saved.decision?.decision).toBe("reship");
  });
});

describe("POST /api/cases/[id]/follow-up: which engine runs", () => {
  const passThrough = (calls: ResumeArgs[]) => {
    control.hook = async (...a) => {
      calls.push(a as unknown as ResumeArgs);
      const [c, followUp] = a as unknown as ResumeArgs;
      const { engine } = (a as unknown as ResumeArgs)[2];
      return { ...c, engine, followUps: [followUp], previousRounds: [], updatedAt: new Date().toISOString() } satisfies CaseRecord;
    };
  };

  it("runs a case made on Muse on Muse when the key is there, and counts it against the daily ceiling", async () => {
    await seedLamp({ engine: "muse-spark-1.3" });
    vi.stubEnv("MODEL_API_KEY", "key-factice-for-test");
    const calls: ResumeArgs[] = [];
    passThrough(calls);
    const res = await post();
    expect(res.status).toBe(201);
    expect(calls[0][2].engine).toBe("muse-spark-1.3");
    expect(await res.json()).toMatchObject({ requestedEngine: "muse-spark-1.3", engine: "muse-spark-1.3", fellBack: false });
  });

  it("falls back to the labelled mock beyond the daily ceiling of real runs", async () => {
    await seedLamp({ engine: "muse-spark-1.3" });
    vi.stubEnv("MODEL_API_KEY", "key-factice-for-test");
    vi.stubEnv("DAMAGE_DESK_REAL_RUNS_PER_DAY", "0");
    const calls: ResumeArgs[] = [];
    passThrough(calls);
    const res = await post();
    expect(calls[0][2].engine).toBe("demo-mock");
    expect(await res.json()).toMatchObject({ requestedEngine: "muse-spark-1.3", engine: "demo-mock", fellBack: true, fellBackReason: "daily_limit" });
  });

  it("falls back to the labelled mock when the key is missing", async () => {
    await seedLamp({ engine: "muse-spark-1.3" });
    const calls: ResumeArgs[] = [];
    passThrough(calls);
    expect(await (await post()).json()).toMatchObject({ engine: "demo-mock", fellBack: true, fellBackReason: "no_credentials" });
    expect(calls[0][2].engine).toBe("demo-mock");
  });

  it("keeps a private run private: with no open-weights endpoint it becomes the mock, never the Meta Model API, even with a Muse key", async () => {
    await seedLamp({ engine: "open-weights" });
    vi.stubEnv("MODEL_API_KEY", "key-factice-for-test");
    const calls: ResumeArgs[] = [];
    passThrough(calls);
    const res = await post();
    expect(calls[0][2].engine).toBe("demo-mock");
    expect(await res.json()).toMatchObject({ requestedEngine: "open-weights", engine: "demo-mock", fellBack: true });
  });

  it("runs a private case on the open-weights endpoint when it is configured", async () => {
    await seedLamp({ engine: "open-weights" });
    vi.stubEnv("OPEN_WEIGHTS_BASE_URL", "https://example.invalid/v1");
    vi.stubEnv("OPEN_WEIGHTS_MODEL", "muse-glimmer-test");
    const calls: ResumeArgs[] = [];
    passThrough(calls);
    await post();
    expect(calls[0][2].engine).toBe("open-weights");
  });

  it("keeps a DEMO MODE case in DEMO MODE even when a key is configured now", async () => {
    await seedLamp();
    vi.stubEnv("MODEL_API_KEY", "key-factice-for-test");
    const calls: ResumeArgs[] = [];
    passThrough(calls);
    await post();
    expect(calls[0][2].engine).toBe("demo-mock");
  });
});

describe("POST /api/cases/[id]/follow-up: the simulated reply of the demo button", () => {
  const demoPhoto = () => readFileSync(path.join(process.cwd(), "data", "photos", "lamp-sharp.webp"));

  it("labels a reply that carries the demo photo, byte for byte, as simulated", async () => {
    await seedLamp();
    const res = await post({ photos: [file(demoPhoto(), "lamp-sharp.webp", "image/webp")] });
    expect(res.status).toBe(201);
    expect((await res.json()).simulated).toBe(true);
    expect((await getCase(ID))?.followUps?.[0].simulated).toBe(true);
  });

  it("never takes the label from the request: a field cannot make a real reply simulated", async () => {
    await seedLamp();
    const res = await post({ fields: { simulated: "true" }, photos: [file(PNG)] });
    expect((await res.json()).simulated).toBe(false);
    expect((await getCase(ID))?.followUps?.[0].simulated).toBeUndefined();
  });

  it("a photo that is not the demo one (one byte different) is a real reply", async () => {
    await seedLamp();
    const bytes = Buffer.from(demoPhoto());
    bytes[bytes.length - 1] ^= 0xff;
    const res = await post({ photos: [file(bytes, "lamp-sharp.webp", "image/webp")] });
    expect((await res.json()).simulated).toBe(false);
  });
});
