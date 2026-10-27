import { readFile } from "node:fs/promises";
import { loadDemoCases } from "../store/demo-cases";
import { resolveDemoPhoto } from "../store/demo-photos";
import { hashImage } from "./image-hash";
import type { PhotoHash } from "../types";

// The demo photos are public and reused by design: every visitor files them, often more than
// once. They are therefore never compared with other cases (that would flag the demo itself), but
// they are compared with every report: a demo photo filed for an order other than its own demo
// case is exactly the "same photo for another order" pattern, shown on purpose.

export interface DemoPhotoHash {
  /** Id of the demo case the photo belongs to (data/demo-cases.json). */
  caseId: string;
  /** Order number and e-mail of that demo case, as written there. */
  orderNumber: string;
  customerEmail: string;
  hash: PhotoHash;
}

// One list per project root: the files do not change while the process runs.
const cache = new Map<string, Promise<DemoPhotoHash[]>>();

async function compute(root: string): Promise<DemoPhotoHash[]> {
  const out: DemoPhotoHash[] = [];
  let expected = 0;
  for (const demo of loadDemoCases()) {
    for (const photo of demo.report.photos) {
      expected++;
      const file = resolveDemoPhoto(photo, root);
      if (!file) continue;
      let hash: PhotoHash | null = null;
      try {
        hash = await hashImage(await readFile(/*turbopackIgnore: true*/ file));
      } catch {
        // A missing or unreadable demo photo only means one fewer photo to compare with.
      }
      if (hash) out.push({ caseId: demo.id, orderNumber: demo.report.orderNumber, customerEmail: demo.report.customerEmail, hash });
    }
  }
  // Not silent: if the photos were not shipped with the deployment (outputFileTracingIncludes for
  // /api/reports not taking effect), the headline beat (the vase filed for another order) would show
  // "No signal" live. Once per process (the result is cached); no path, no customer data.
  if (out.length < expected) console.warn(`[integrity] hashed ${out.length} of ${expected} demo photos`);
  return out;
}

/** Hashes of the demo photos that exist on this server (the six, unless a file is missing). */
export function loadDemoPhotoHashes(root: string = process.cwd()): Promise<DemoPhotoHash[]> {
  let pending = cache.get(root);
  if (!pending) {
    pending = compute(root);
    cache.set(root, pending);
  }
  return pending;
}
