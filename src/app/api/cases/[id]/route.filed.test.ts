import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase } from "@/components/fixtures";
import type { CaseRecord } from "@/lib/types";

const getCase = vi.fn();
const updateCase = vi.fn();
vi.mock("@/lib/store/cases", () => ({
  getCase: (id: string) => getCase(id),
  updateCase: (id: string, patch: unknown, options: unknown) => updateCase(id, patch, options),
}));

import { PATCH } from "./route";

const ctx = { params: Promise.resolve({ id: "case-1" }) };
const patch = (body: unknown) =>
  PATCH(new Request("http://localhost/api/cases/case-1", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "");
  updateCase.mockImplementation(async (_id: string, p: Partial<CaseRecord>) => ({ ...makeCase(), ...p }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  getCase.mockReset();
  updateCase.mockReset();
});

describe("PATCH /api/cases/[id] with claimFiled", () => {
  it("notes that the merchant filed the claim, on an approved case with an eligible claim, and traces it without claiming Gilmend did anything", async () => {
    getCase.mockResolvedValue(makeCase({ status: "approved" }));
    const res = await patch({ claimFiled: true });
    expect(res.status).toBe(200);
    const [, applied, options] = updateCase.mock.calls[0];
    expect(typeof applied.claimFiledAt).toBe("string");
    expect(applied.status).toBeUndefined();
    expect(options.appendTrace).toHaveLength(1);
    expect(options.appendTrace[0].step).toMatch(/marked the carrier claim as filed.*Gilmend filed nothing/);
  });

  it("refuses it on a case that is not approved, or whose claim is not eligible", async () => {
    getCase.mockResolvedValue(makeCase({ status: "needs_review" }));
    expect((await patch({ claimFiled: true })).status).toBe(409);
    getCase.mockResolvedValue(makeCase({ status: "approved", claim: { ...makeCase().claim!, eligible: false, maxCompensationEur: 0 } }));
    const refused = await patch({ claimFiled: true });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("claim_not_fileable");
    expect(updateCase).not.toHaveBeenCalled();
  });

  it("refuses it when the agent decided against a carrier claim: the same test as the morning sweep's plan", async () => {
    const base = makeCase({ status: "approved" });
    getCase.mockResolvedValue({ ...base, decision: { ...base.decision!, carrierClaim: false } });
    const refused = await patch({ claimFiled: true });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("claim_not_fileable");
    expect(updateCase).not.toHaveBeenCalled();
  });

  it("clears the note with false (null, because the store drops undefined)", async () => {
    getCase.mockResolvedValue(makeCase({ status: "approved", claimFiledAt: "2026-10-28T09:00:00.000Z" }));
    expect((await patch({ claimFiled: false })).status).toBe(200);
    expect(updateCase.mock.calls[0][1].claimFiledAt).toBeNull();
  });

  it("changes nothing when the note is already as asked", async () => {
    getCase.mockResolvedValue(makeCase({ status: "approved", claimFiledAt: "2026-10-28T09:00:00.000Z" }));
    expect((await patch({ claimFiled: true })).status).toBe(200);
    getCase.mockResolvedValue(makeCase({ status: "approved" }));
    expect((await patch({ claimFiled: false })).status).toBe(200);
    expect(updateCase).not.toHaveBeenCalled();
  });

  it("takes only a boolean, and still needs the access code on a public deployment", async () => {
    getCase.mockResolvedValue(makeCase({ status: "approved" }));
    expect((await patch({ claimFiled: "yes" })).status).toBe(400);
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "a-long-random-test-code-0123456789");
    expect((await patch({ claimFiled: true })).status).toBe(401);
    expect(updateCase).not.toHaveBeenCalled();
  });
});
