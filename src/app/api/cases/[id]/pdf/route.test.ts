import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase } from "@/components/fixtures";
import { resetRateLimits } from "../../../_lib/rate-limit";

const getCase = vi.fn();
const updateCase = vi.fn();
const buildClaimDocument = vi.fn();
vi.mock("@/lib/store/cases", () => ({
  getCase: (id: string) => getCase(id),
  updateCase: (id: string, p: unknown) => updateCase(id, p),
}));
vi.mock("@/lib/documents/claim-pdf", () => ({ buildClaimDocument: (c: unknown) => buildClaimDocument(c) }));

import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const PDF = Buffer.from("%PDF-1.7\nfake body\n%%EOF");

let root: string;
let outside: string;

beforeEach(async () => {
  resetRateLimits();
  const base = await mkdtemp(path.join(os.tmpdir(), "dd-pdf-"));
  root = path.join(base, "runtime");
  outside = path.join(base, "secret.pdf");
  await mkdir(path.join(root, "claims"), { recursive: true });
  await writeFile(path.join(root, "claims", "case-1.pdf"), PDF);
  await writeFile(outside, "TOP SECRET");
  vi.stubEnv("DAMAGE_DESK_RUNTIME_DIR", root);
  getCase.mockResolvedValue(makeCase({ document: { ...makeCase().document!, pdfPath: path.join(root, "claims", "case-1.pdf") } }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  getCase.mockReset();
  updateCase.mockReset();
  buildClaimDocument.mockReset();
  await rm(path.dirname(root), { recursive: true, force: true });
});

describe("GET /api/cases/[id]/pdf", () => {
  it("serves the claim PDF inline", async () => {
    const res = await GET(new Request("http://localhost/api/cases/case-1/pdf"), ctx("case-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    expect(buildClaimDocument).not.toHaveBeenCalled();
  });

  it("serves it as a download with ?download=1", async () => {
    const res = await GET(new Request("http://localhost/api/cases/case-1/pdf?download=1"), ctx("case-1"));
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="claim-case-1\.pdf"/);
  });

  it("never reads a PDF path that points outside data/runtime", async () => {
    getCase.mockResolvedValue(makeCase({ document: { ...makeCase().document!, pdfPath: outside } }));
    buildClaimDocument.mockResolvedValue({ ...makeCase().document!, pdfPath: path.join(root, "claims", "case-1.pdf") });
    const res = await GET(new Request("http://localhost/x"), ctx("case-1"));
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.toString()).not.toMatch(/TOP SECRET/);
    expect(bytes.equals(PDF)).toBe(true); // regenerated inside the runtime folder instead
  });

  it("builds the PDF on the spot when the case has a claim but no file yet, and stores it", async () => {
    getCase.mockResolvedValue(makeCase({ document: null }));
    const doc = { ...makeCase().document!, pdfPath: path.join(root, "claims", "case-1.pdf") };
    buildClaimDocument.mockResolvedValue(doc);
    const res = await GET(new Request("http://localhost/x"), ctx("case-1"));
    expect(res.status).toBe(200);
    expect(updateCase).toHaveBeenCalledWith("case-1", { document: doc });
  });

  it("answers 404 for a case that needs no carrier claim", async () => {
    getCase.mockResolvedValue(
      makeCase({ document: null, decision: { ...makeCase().decision!, carrierClaim: false } }),
    );
    const res = await GET(new Request("http://localhost/x"), ctx("case-1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no_claim_document");
    expect(buildClaimDocument).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown or malformed id", async () => {
    getCase.mockResolvedValue(null);
    expect((await GET(new Request("http://x"), ctx("nope"))).status).toBe(404);
    expect((await GET(new Request("http://x"), ctx("../nope"))).status).toBe(404);
  });

  it("answers 500 when the PDF builder fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getCase.mockResolvedValue(makeCase({ document: null }));
    buildClaimDocument.mockRejectedValue(new Error("pdf engine crashed"));
    expect((await GET(new Request("http://x"), ctx("case-1"))).status).toBe(500);
  });
});

describe("GET /api/cases/[id]/pdf on a public deployment", () => {
  const CODE = "judges-2026-k7Qm";
  const request = (code?: string) =>
    new Request("http://localhost/api/cases/case-1/pdf", { headers: code === undefined ? {} : { "x-access-code": code } });

  beforeEach(() => vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", CODE));

  it("serves an existing PDF to anyone: the page's iframe and the download link cannot send the code", async () => {
    const res = await GET(request(), ctx("case-1"));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    expect(buildClaimDocument).not.toHaveBeenCalled();
  });

  it("does not build a PDF for a visitor without the code, and writes nothing", async () => {
    getCase.mockResolvedValue(makeCase({ document: null }));
    for (const code of [undefined, "wrong"]) {
      const res = await GET(request(code), ctx("case-1"));
      expect(res.status, String(code)).toBe(401);
      expect((await res.json()).error).toBe("access_code_required");
    }
    expect(buildClaimDocument).not.toHaveBeenCalled();
    expect(updateCase).not.toHaveBeenCalled();
  });

  it("builds it with the right code, and counts wrong codes like the other routes", async () => {
    getCase.mockResolvedValue(makeCase({ document: null }));
    const doc = { ...makeCase().document!, pdfPath: path.join(root, "claims", "case-1.pdf") };
    buildClaimDocument.mockResolvedValue(doc);
    const res = await GET(request(CODE), ctx("case-1"));
    expect(res.status).toBe(200);
    expect(updateCase).toHaveBeenCalledWith("case-1", { document: doc });

    for (let i = 0; i < 10; i++) await GET(request(`guess-${i}`), ctx("case-1"));
    expect((await GET(request(CODE), ctx("case-1"))).status).toBe(429);
  });

  it("still answers 404 for a case with no claim, before asking for any code", async () => {
    getCase.mockResolvedValue(makeCase({ document: null, decision: { ...makeCase().decision!, carrierClaim: false } }));
    expect((await GET(request(), ctx("case-1"))).status).toBe(404);
  });
});

