import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFauxObjectStore, type FauxObjectStore } from "@/lib/storage/faux-object-store";
import { overrideSharedObjects } from "@/lib/storage";
import { demoPhotoBytes, recompress, syntheticPhoto } from "@/lib/integrity/test-helpers";
import type { CaseRecord } from "@/lib/types";
import { resetRateLimits } from "./_lib/rate-limit";
import { GET as getCase } from "./cases/[id]/route";
import { POST as postReport } from "./reports/route";

// Photo integrity end to end, through the real route and the real stores (demo mode, no model):
// the hashes of a case are kept on the case record, so a later report is compared with them
// whatever instance served the first one. "Instance B" is the same runtime path with an empty disk,
// sharing the bucket, as in shared-storage.test.ts.

let runtime: string;
let objects: FauxObjectStore;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const CUSTOMERS = {
  camille: { orderNumber: "#1001", email: "camille.laurent@example.com", message: "Hi, my vase arrived broken this morning." },
  hugo: { orderNumber: "#1002", email: "hugo.bernard@example.com", message: "My vase arrived broken today, see the photo." },
};

async function fileReport(who: (typeof CUSTOMERS)["camille"], photo: Buffer, type = "image/jpeg"): Promise<CaseRecord> {
  const form = new FormData();
  form.set("orderNumber", who.orderNumber);
  form.set("email", who.email);
  form.set("message", who.message);
  form.append("photos", new File([new Uint8Array(photo)], "photo.jpg", { type }));
  const res = await postReport(new Request("http://localhost/api/reports", { method: "POST", body: form }));
  expect(res.status).toBe(201);
  const { caseId } = (await res.json()) as { caseId: string };
  const body = (await (await getCase(new Request("http://x"), ctx(caseId))).json()) as { case: CaseRecord };
  return body.case;
}

/** A new serverless instance: same runtime path, empty disk, same bucket. */
async function freshInstance(): Promise<void> {
  await rm(runtime, { recursive: true, force: true });
}

beforeEach(async () => {
  runtime = await mkdtemp(path.join(os.tmpdir(), "dd-integrity-e2e-"));
  vi.stubEnv("DAMAGE_DESK_RUNTIME_DIR", runtime);
  vi.stubEnv("MODEL_API_KEY", "");
  vi.stubEnv("OPEN_WEIGHTS_BASE_URL", "");
  vi.stubEnv("OPEN_WEIGHTS_MODEL", "");
  resetRateLimits();
  objects = createFauxObjectStore();
  overrideSharedObjects(objects);
});
afterEach(async () => {
  overrideSharedObjects(undefined);
  vi.unstubAllEnvs();
  await rm(runtime, { recursive: true, force: true });
});

describe("the same photo filed for another order", () => {
  it("is caught on a second instance from the hashes kept on the first case, even re-saved smaller", async () => {
    const photo = await syntheticPhoto(21);
    const first = await fileReport(CUSTOMERS.camille, photo);
    expect(first.integrity?.signals).toEqual([]);
    expect(first.integrity?.photos[0].hash).toMatchObject({ dhash: expect.stringMatching(/^[0-9a-f]{16}$/), ahash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(first.decision?.needsHuman).toBe(false);

    // What the agent decides for this customer when nothing is wrong with the photo.
    const control = await fileReport(CUSTOMERS.hugo, await syntheticPhoto(99));
    expect(control.integrity?.signals).toEqual([]);

    await freshInstance(); // the first photo is no longer on this disk: only the case records are shared

    const second = await fileReport(CUSTOMERS.hugo, await recompress(photo));
    expect(second.integrity?.signals.map((s) => s.kind)).toEqual(["reused_photo"]);
    expect(second.integrity?.photos[0].matches).toEqual([
      expect.objectContaining({ source: "case", caseId: first.id, sameOrderAndCustomer: false }),
    ]);
    expect(second.integrity?.comparedCases).toBe(2);
    expect(second.decision?.needsHuman).toBe(true);
    expect(second.decision?.reasons.join(" ")).toMatch(/Guardrail: photo integrity: Photo 1 looks like a photo already filed in 1 other case/);
    expect(second.status).toBe("needs_review"); // never rejected on its own
    // Nothing else changed: the same decision and the same claim as without the signal, so the
    // merchant decides with everything in front of them.
    expect(second.decision?.decision).toBe(control.decision?.decision);
    expect(second.decision?.carrierClaim).toBe(control.decision?.carrierClaim);
    expect(Boolean(second.document)).toBe(Boolean(control.document));
    expect(second.trace.some((t) => t.tool === "check_photo_integrity")).toBe(true);
  });

  it("does not flag the same customer filing the same photo again for the same order", async () => {
    const photo = await syntheticPhoto(22);
    await fileReport(CUSTOMERS.camille, photo);
    const again = await fileReport(CUSTOMERS.camille, await recompress(photo));
    expect(again.integrity?.signals).toEqual([]);
    expect(again.integrity?.photos[0].matches[0]).toMatchObject({ sameOrderAndCustomer: true });
    expect(again.decision?.needsHuman).toBe(false);
  });

  it("does not flag a different photo for another order", async () => {
    await fileReport(CUSTOMERS.camille, await syntheticPhoto(23));
    const other = await fileReport(CUSTOMERS.hugo, await syntheticPhoto(24));
    expect(other.integrity?.signals).toEqual([]);
    expect(other.integrity?.comparedCases).toBe(1);
  });
});

describe("the demo photos", () => {
  it("can be filed by their own demo case any number of times without a signal", async () => {
    const vase = demoPhotoBytes("vase-broken");
    for (let i = 0; i < 3; i++) {
      const c = await fileReport(CUSTOMERS.camille, vase, "image/webp");
      expect(c.integrity?.signals, `filing ${i + 1}`).toEqual([]);
      expect(c.decision?.needsHuman).toBe(false);
    }
  });

  it("are flagged when filed for a different order than their own demo case", async () => {
    const c = await fileReport(CUSTOMERS.hugo, demoPhotoBytes("vase-broken"), "image/webp");
    expect(c.integrity?.signals.map((s) => s.kind)).toEqual(["demo_photo_reused"]);
    expect(c.decision?.needsHuman).toBe(true);
  });

  it("are not compared with other cases: a flagged use does not make the legitimate one a duplicate", async () => {
    const vase = demoPhotoBytes("vase-broken");
    await fileReport(CUSTOMERS.hugo, vase, "image/webp"); // flagged
    const own = await fileReport(CUSTOMERS.camille, vase, "image/webp");
    expect(own.integrity?.signals).toEqual([]);
  });
});

describe("the capture date", () => {
  it("flags a photo whose EXIF date is long before the delivery", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 19).replace(/-/g, ":").replace("T", " ");
    const c = await fileReport(CUSTOMERS.camille, await syntheticPhoto(31, tenDaysAgo));
    expect(c.integrity?.signals.map((s) => s.kind)).toEqual(["captured_before_delivery"]);
    expect(c.integrity?.photos[0].capturedAt).toBe(tenDaysAgo.replace(/^(\d{4}):(\d{2}):(\d{2}) /, "$1-$2-$3T"));
    expect(c.decision?.needsHuman).toBe(true);
  });

  it("does not flag a photo taken after the delivery", async () => {
    const justNow = new Date(Date.now() - 3_600_000).toISOString().slice(0, 19).replace(/-/g, ":").replace("T", " ");
    const c = await fileReport(CUSTOMERS.camille, await syntheticPhoto(32, justNow));
    expect(c.integrity?.signals).toEqual([]);
  });

  it("does not flag a photo with no EXIF at all (what most uploads look like), and says why", async () => {
    const c = await fileReport(CUSTOMERS.camille, await syntheticPhoto(33));
    expect(c.integrity?.signals).toEqual([]);
    expect(c.integrity?.notes.join(" ")).toMatch(/not treated as a signal/);
  });
});

describe("the stored case", () => {
  it("keeps the integrity result small and free of the other customers' data", async () => {
    const photo = await syntheticPhoto(41);
    await fileReport(CUSTOMERS.camille, photo);
    const second = await fileReport(CUSTOMERS.hugo, photo);
    const raw = await readFile(path.join(runtime, "cases", `${second.id}.json`), "utf8").catch(() => null);
    const text = raw ?? JSON.stringify(second);
    const integrity = JSON.stringify(second.integrity);
    expect(integrity.length).toBeLessThan(2000);
    expect(integrity).not.toMatch(/camille|laurent|1001/i);
    expect(text).toContain('"integrity"');
  });
});
