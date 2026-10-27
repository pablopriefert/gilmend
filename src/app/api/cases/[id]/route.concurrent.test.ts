import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase } from "@/components/fixtures";
import { createFauxObjectStore } from "@/lib/storage/faux-object-store";
import { createObjectCaseStore } from "@/lib/store/object-case-store";
import type { CaseStore } from "@/lib/store/file-store";

// The route on top of a real store (not a mock): two PATCHes that both read the case before
// either writes, as two tabs or two judges would, must both leave their trace line.
let store: CaseStore;
vi.mock("@/lib/store/cases", () => ({
  getCase: (id: string) => store.get(id),
  updateCase: (id: string, patch: never, options: never) => store.update(id, patch, options),
}));

import { PATCH } from "./route";

const patch = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/cases/case-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "case-1" }) },
  );

beforeEach(async () => {
  store = createObjectCaseStore({ objects: createFauxObjectStore() });
  await store.save(makeCase({ id: "case-1" }));
});
afterEach(() => vi.restoreAllMocks());

describe("PATCH /api/cases/[id], two concurrent changes", () => {
  it("keeps both trace lines, and both changes", async () => {
    const before = makeCase().trace.length;
    const [a, b] = await Promise.all([patch({ status: "approved" }), patch({ customerReply: "A new vase is on its way." })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const final = (await store.get("case-1"))!;
    expect(final.status).toBe("approved");
    expect(final.decision?.customerReply).toBe("A new vase is on its way.");
    expect(final.trace).toHaveLength(before + 2);
    expect(final.trace.slice(before).map((t) => t.step).sort()).toEqual([
      "Merchant approved the case. Ready to send; nothing was sent.",
      "Merchant edited the customer reply.",
    ]);
  });
});
