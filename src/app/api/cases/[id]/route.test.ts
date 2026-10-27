import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase } from "@/components/fixtures";
import type { CaseRecord } from "@/lib/types";

const getCase = vi.fn();
const updateCase = vi.fn();
vi.mock("@/lib/store/cases", () => ({
  getCase: (id: string) => getCase(id),
  updateCase: (id: string, patch: unknown, options: unknown) => updateCase(id, patch, options),
}));

import { GET, PATCH } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown, id = "case-1") =>
  PATCH(
    new Request(`http://localhost/api/cases/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    ctx(id),
  );

beforeEach(() => {
  getCase.mockResolvedValue(makeCase());
  updateCase.mockImplementation(async (_id: string, p: Partial<CaseRecord>, o?: { appendTrace?: CaseRecord["trace"] }) => ({
    ...makeCase(),
    ...p,
    trace: [...makeCase().trace, ...(o?.appendTrace ?? [])],
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  getCase.mockReset();
  updateCase.mockReset();
  vi.restoreAllMocks();
});

describe("GET /api/cases/[id]", () => {
  it("returns the case", async () => {
    const res = await GET(new Request("http://localhost/api/cases/case-1"), ctx("case-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).case.id).toBe("case-1");
  });

  it("answers 404 for an unknown id", async () => {
    getCase.mockResolvedValue(null);
    expect((await GET(new Request("http://x"), ctx("nope"))).status).toBe(404);
  });

  it("answers 404 without touching the store for an id that is not a plain id", async () => {
    for (const id of ["../../etc/passwd", "a b", "x".repeat(81), "a%2Fb"]) {
      expect((await GET(new Request("http://x"), ctx(id))).status, id).toBe(404);
    }
    expect(getCase).not.toHaveBeenCalled();
  });

  it("answers 500 when the store fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getCase.mockRejectedValue(new Error("EACCES /secret"));
    const res = await GET(new Request("http://x"), ctx("case-1"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/);
  });
});

describe("PATCH /api/cases/[id]", () => {
  it("approves the case and records it in the trace, without sending anything", async () => {
    const res = await patch({ status: "approved" });
    expect(res.status).toBe(200);
    const [, applied, options] = updateCase.mock.calls[0];
    expect(applied.status).toBe("approved");
    // Only the new line is sent: the store appends it to the trace it reads under its lock.
    expect(applied.trace).toBeUndefined();
    expect(options.appendTrace).toHaveLength(1);
    expect(options.appendTrace[0].step).toMatch(/nothing was sent/i);
    expect((await res.json()).case.status).toBe("approved");
  });

  it("rejects and reopens", async () => {
    await patch({ status: "rejected" });
    expect(updateCase.mock.calls[0][1].status).toBe("rejected");
    getCase.mockResolvedValue(makeCase({ status: "rejected" }));
    await patch({ status: "needs_review" });
    expect(updateCase.mock.calls[1][1].status).toBe("needs_review");
    expect(updateCase.mock.calls[1][2].appendTrace.at(-1).step).toMatch(/reopened/i);
  });

  it("never lets anyone mark a case as sent", async () => {
    for (const status of ["sent_to_customer", "new", "whatever", 3]) {
      const res = await patch({ status });
      expect(res.status, String(status)).toBe(400);
    }
    expect(updateCase).not.toHaveBeenCalled();
  });

  it("edits the customer reply and keeps the rest of the decision", async () => {
    const res = await patch({ customerReply: "  Hello, a new vase is on its way.  " });
    expect(res.status).toBe(200);
    const [, applied, options] = updateCase.mock.calls[0];
    expect(applied.decision.customerReply).toBe("Hello, a new vase is on its way.");
    expect(applied.decision.decision).toBe("reship");
    expect(applied.status).toBeUndefined();
    expect(options.appendTrace.at(-1).step).toMatch(/edited/i);
  });

  it("approves and edits in one call", async () => {
    await patch({ status: "approved", customerReply: "New text" });
    const [, applied, options] = updateCase.mock.calls[0];
    expect(applied.status).toBe("approved");
    expect(applied.decision.customerReply).toBe("New text");
    expect(options.appendTrace).toHaveLength(2);
  });

  it("does not write when nothing changes", async () => {
    const res = await patch({ status: "needs_review" });
    expect(res.status).toBe(200);
    expect(updateCase).not.toHaveBeenCalled();
  });

  it("validates the body", async () => {
    expect((await patch("not json")).status).toBe(400);
    expect((await patch([])).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ customerReply: "   " })).status).toBe(400);
    expect((await patch({ customerReply: 12 })).status).toBe(400);
    expect((await patch({ customerReply: "x".repeat(4001) })).status).toBe(400);
    expect(updateCase).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown case", async () => {
    getCase.mockResolvedValue(null);
    expect((await patch({ status: "approved" })).status).toBe(404);
    expect((await patch({ status: "approved" }, "../x")).status).toBe(404);
  });

  it("refuses to approve a case the agent never decided, but lets a human reject it", async () => {
    getCase.mockResolvedValue(makeCase({ decision: null, status: "new" }));
    expect((await patch({ status: "approved" })).status).toBe(409);
    expect((await patch({ customerReply: "hi" })).status).toBe(409);
    expect((await patch({ status: "rejected" })).status).toBe(200);
  });

  it("answers 500 when the store fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getCase.mockRejectedValue(new Error("EACCES /secret"));
    expect((await patch({ status: "approved" })).status).toBe(500);
  });
});

describe("PATCH /api/cases/[id] on a public deployment", () => {
  const withCode = (code?: string) =>
    PATCH(
      new Request("http://localhost/api/cases/case-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(code === undefined ? {} : { "x-access-code": code }) },
        body: JSON.stringify({ status: "approved" }),
      }),
      ctx("case-1"),
    );

  it("refuses every change without the access code, and changes nothing", async () => {
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "judges-2026");
    for (const code of [undefined, "", "wrong", "judges"]) {
      const res = await withCode(code);
      expect(res.status, String(code)).toBe(401);
      expect((await res.json()).error).toBe("access_code_required");
    }
    expect(updateCase).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("accepts the right code", async () => {
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "judges-2026");
    expect((await withCode("judges-2026")).status).toBe(200);
    expect(updateCase).toHaveBeenCalledOnce();
    vi.unstubAllEnvs();
  });

  it("does not check anything when no code is configured (local development)", async () => {
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "");
    expect((await withCode()).status).toBe(200);
    vi.unstubAllEnvs();
  });
});
