import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDemoCases } from "@/lib/store/demo-cases";
import { createFauxObjectStore, type FauxObjectStore } from "@/lib/storage/faux-object-store";
import { overrideSharedObjects } from "@/lib/storage";
import type { CaseRecord } from "@/lib/types";
import { resetRateLimits } from "./_lib/rate-limit";
import { GET as getCase } from "./cases/[id]/route";
import { GET as getPdf } from "./cases/[id]/pdf/route";
import { GET as listCases } from "./cases/route";
import { GET as getFile } from "./files/route";
import { POST as postReport } from "./reports/route";

// Two serverless instances in one test: they share a "bucket" (the faux ObjectStore) and
// each has its own disk. Vercel gives every instance the same path for it (/tmp/damage-desk),
// so "instance B" is the same runtime path with nothing in it.

let runtime: string;
let objects: FauxObjectStore;

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 160, height: 120, channels: 3, background: "#8a8a8a" } }).png().toBuffer();
}

async function fileReport(): Promise<Response> {
  const demo = loadDemoCases()[0].report; // the broken vase, order #1001: a claim is due
  const form = new FormData();
  form.set("orderNumber", demo.orderNumber);
  form.set("email", demo.customerEmail);
  form.set("message", demo.message);
  form.append("photos", new File([new Uint8Array(await png())], "photo.png", { type: "image/png" }));
  return postReport(new Request("http://localhost/api/reports", { method: "POST", body: form }));
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** A new serverless instance: same runtime path, empty disk. */
async function freshInstance(): Promise<void> {
  await rm(runtime, { recursive: true, force: true });
}

beforeEach(async () => {
  runtime = await mkdtemp(path.join(os.tmpdir(), "dd-shared-"));
  vi.stubEnv("DAMAGE_DESK_RUNTIME_DIR", runtime);
  vi.stubEnv("MODEL_API_KEY", "");
  vi.stubEnv("OPEN_WEIGHTS_BASE_URL", "");
  vi.stubEnv("OPEN_WEIGHTS_MODEL", "");
  resetRateLimits();
  objects = createFauxObjectStore();
});
afterEach(async () => {
  overrideSharedObjects(undefined);
  vi.unstubAllEnvs();
  await rm(runtime, { recursive: true, force: true });
});

describe("a case filed on one instance and opened on another", () => {
  it("without a shared store the other instance has nothing: the problem this exists for", async () => {
    const res = await fileReport();
    expect(res.status).toBe(201);
    const { caseId } = await res.json();
    expect((await getCase(new Request("http://x"), ctx(caseId))).status).toBe(200);
    await freshInstance();
    expect((await getCase(new Request("http://x"), ctx(caseId))).status).toBe(404);
  });

  it("with a shared store the case, its photo and its claim PDF follow", async () => {
    overrideSharedObjects(objects);
    const res = await fileReport();
    expect(res.status).toBe(201);
    const { caseId } = (await res.json()) as { caseId: string };

    const stored = ((await (await getCase(new Request("http://x"), ctx(caseId))).json()) as { case: CaseRecord }).case;
    expect(stored.decision?.carrierClaim).toBe(true);
    expect(stored.document).not.toBeNull();
    // What went to the shared store: the case, the uploaded photo, the claim PDF.
    expect(objects.keys()).toEqual(
      expect.arrayContaining([`cases/${caseId}.json`, expect.stringMatching(/^files\/uploads\/.+\/photo-1\.png$/), expect.stringMatching(/^files\/claims\/.+\.pdf$/)]),
    );

    await freshInstance();

    // The list and the case come from the store.
    const listed = ((await (await listCases()).json()) as { cases: CaseRecord[] }).cases;
    expect(listed.map((c) => c.id)).toEqual([caseId]);
    expect((await getCase(new Request("http://x"), ctx(caseId))).status).toBe(200);

    // The photo and the PDF are downloaded into this instance's empty disk on first request.
    const photo = await getFile(new Request(`http://x/api/files?p=${encodeURIComponent(stored.report.photos[0])}`));
    expect(photo.status).toBe(200);
    expect(photo.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await photo.arrayBuffer()).equals(await png())).toBe(true);

    const pdf = await getPdf(new Request(`http://x/api/cases/${caseId}/pdf`), ctx(caseId));
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("a file the shared store does not hold is still a 404, and a path outside the runtime folder is never fetched", async () => {
    overrideSharedObjects(objects);
    await freshInstance();
    expect((await getFile(new Request("http://x/api/files?p=uploads%2Fnope%2Fphoto-1.png"))).status).toBe(404);
    expect((await getFile(new Request("http://x/api/files?p=..%2F..%2Fetc%2Fpasswd.png"))).status).toBe(404);
    expect(objects.calls.filter((c) => c.key.includes(".."))).toEqual([]);
  });
});
