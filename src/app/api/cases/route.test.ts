import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCase } from "@/components/fixtures";

const listCases = vi.fn();
vi.mock("@/lib/store/cases", () => ({ listCases: () => listCases() }));

import { GET } from "./route";

afterEach(() => {
  listCases.mockReset();
  vi.restoreAllMocks();
});

describe("GET /api/cases", () => {
  it("returns the cases and the counter numbers", async () => {
    listCases.mockResolvedValue([makeCase({ id: "a" }), makeCase({ id: "b" })]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cases.map((c: { id: string }) => c.id)).toEqual(["a", "b"]);
    expect(body.summary).toEqual({
      recoverableThisMonthEur: expect.any(Number),
      demoModeCases: expect.any(Number),
      simulatedReplyCases: expect.any(Number),
      claimsDueThisWeek: expect.any(Number),
      dueCaseIds: expect.any(Array),
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers an empty list, not an error, when there are no cases", async () => {
    listCases.mockResolvedValue([]);
    const body = await (await GET()).json();
    expect(body.cases).toEqual([]);
    expect(body.summary.recoverableThisMonthEur).toBe(0);
  });

  it("answers 500 for a real failure, without leaking the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listCases.mockRejectedValue(new Error("EACCES /secret/path"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/);
  });
});
