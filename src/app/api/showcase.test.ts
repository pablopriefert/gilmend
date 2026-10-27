import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseRecord } from "@/lib/types";
import { PATCH, GET as getCase } from "./cases/[id]/route";
import { GET as getPdf } from "./cases/[id]/pdf/route";
import { GET as listCases } from "./cases/route";
import { GET as getFile } from "./files/route";

const REPO_SHOWCASE = path.join(process.cwd(), "data", "showcase");
const ID = "real_demo-1-vase-broken";
// A recorded case that carries a claim PDF (the vase, case 1, has one too since the re-recording
// of 27 Oct 2026; the earlier vase run ended without a claim because Muse read the box as
// inadequate packaging, which no longer cancels a claim).
const PDF_ID = "real_demo-4-opened-missing";

let scratch: string;
let showcase: string;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const files = (p: string) => getFile(new Request(`http://x/api/files?p=${encodeURIComponent(p)}`));
const patch = (body: unknown, headers: Record<string, string> = {}) =>
  PATCH(
    new Request(`http://x/api/cases/${ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    ctx(ID),
  );

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

beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "dd-showcase-api-"));
  showcase = path.join(scratch, "showcase");
  await cp(REPO_SHOWCASE, showcase, { recursive: true });
  vi.stubEnv("DAMAGE_DESK_SHOWCASE_DIR", showcase);
  vi.stubEnv("DAMAGE_DESK_RUNTIME_DIR", path.join(scratch, "runtime"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe("the recorded runs through the API, with an empty store", () => {
  it("GET /api/cases lists the six recorded runs, and the header counter does not count them", async () => {
    const body = (await (await listCases()).json()) as { cases: CaseRecord[]; summary: Record<string, unknown> };
    expect(body.cases).toHaveLength(6);
    expect(body.cases.every((c) => c.recorded?.recordedOn === "2026-10-27" && c.engine === "muse-spark-1.3")).toBe(true);
    expect(body.summary).toMatchObject({ recoverableThisMonthEur: 0, claimsDueThisWeek: 0, demoModeCases: 0 });
  });

  it("GET /api/cases/[id] returns a recorded run", async () => {
    const res = await getCase(new Request("http://x"), ctx(ID));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { case: CaseRecord }).case.recorded).toEqual({ recordedOn: "2026-10-27" });
  });

  it("serves the customer photo and the annotated evidence from data/showcase, as images", async () => {
    const c = ((await (await getCase(new Request("http://x"), ctx(ID))).json()) as { case: CaseRecord }).case;
    const photo = await files(c.report.photos[0].replace("data/showcase/", "showcase/"));
    expect(photo.status).toBe(200);
    expect(photo.headers.get("Content-Type")).toBe("image/webp");
    const annotated = await files(c.evidence[0].annotatedPhoto!.replace("data/showcase/", "showcase/"));
    expect(annotated.status).toBe(200);
    expect(annotated.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("serves the recorded claim PDF, inline and as a download", async () => {
    const inline = await getPdf(new Request(`http://x/api/cases/${PDF_ID}/pdf`), ctx(PDF_ID));
    expect(inline.status).toBe(200);
    expect(inline.headers.get("Content-Type")).toBe("application/pdf");
    expect(inline.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(Buffer.from(await inline.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const download = await getPdf(new Request(`http://x/api/cases/${PDF_ID}/pdf?download=1`), ctx(PDF_ID));
    expect(download.headers.get("Content-Disposition")).toMatch(/^attachment; filename="claim-real_demo-4-opened-missing\.pdf"/);
  });

  it("a recorded run with no carrier claim has no PDF", async () => {
    for (const id of ["real_demo-2-carton-crushed", "real_demo-3-photo-blurry", "real_demo-6-late-report"]) {
      const res = await getPdf(new Request(`http://x/api/cases/${id}/pdf`), ctx(id));
      expect(res.status, id).toBe(404);
    }
  });

  it("does not serve anything else through the showcase paths", async () => {
    expect((await files("showcase/cases/real_demo-1-vase-broken.json")).status).toBe(404);
    expect((await files("showcase/../../package.json")).status).toBe(404);
    expect((await files("showcase/photos/nope.webp")).status).toBe(404);
  });
});

describe("approving, editing or rejecting a recorded run", () => {
  it("stores a copy and leaves the committed files untouched", async () => {
    const before = await fingerprint(showcase);

    const approved = await patch({ status: "approved" });
    expect(approved.status).toBe(200);
    const copy = ((await approved.json()) as { case: CaseRecord }).case;
    expect(copy).toMatchObject({ id: ID, status: "approved", engine: "muse-spark-1.3", recorded: { recordedOn: "2026-10-27" } });
    expect(copy.trace.at(-1)?.step).toMatch(/Merchant approved the case/);

    const edited = await patch({ customerReply: "Hi Camille, a new vase is on its way." });
    expect(((await edited.json()) as { case: CaseRecord }).case.decision?.customerReply).toBe("Hi Camille, a new vase is on its way.");

    // The copy is the case from now on, once in the list, with its files still served.
    const listed = ((await (await listCases()).json()) as { cases: CaseRecord[] }).cases;
    expect(listed).toHaveLength(6);
    expect(listed.find((c) => c.id === ID)?.status).toBe("approved");
    expect(listed.find((c) => c.id === ID)?.evidence[0].annotatedPhoto).toBeTruthy();

    expect(await fingerprint(showcase)).toBe(before);
    const original = JSON.parse(await readFile(path.join(showcase, "cases", `${ID}.json`), "utf8")) as CaseRecord;
    expect(original.status).toBe("needs_review");
    expect(original.decision?.customerReply).not.toBe("Hi Camille, a new vase is on its way.");
  });

  it("is refused without the access code on a public deployment, and then nothing is copied", async () => {
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "demo-code");
    expect((await patch({ status: "approved" })).status).toBe(401);
    expect(await readdir(path.join(scratch, "runtime")).catch(() => [])).toEqual([]);
    expect((await patch({ status: "approved" }, { "x-access-code": "demo-code" })).status).toBe(200);
  });
});
