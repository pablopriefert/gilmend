import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase } from "@/components/fixtures";
import { parseFixtureOrders } from "../orders/fixtures";
import type { CaseRecord } from "../types";
import { auditShowcaseCase, auditText, carrierEmails, pdfText, referencedFiles, type AuditContext } from "./audit";
import { listShowcaseCases, SHOWCASE_PATH_PREFIX } from "./showcase";

const ROOT = process.cwd();
const SHOWCASE = path.join(ROOT, "data", "showcase");

let context: AuditContext;
beforeAll(() => {
  context = {
    fixtures: parseFixtureOrders(JSON.parse(readFileSync(path.join(ROOT, "data/fixtures/orders.json"), "utf8"))),
    allowedEmails: carrierEmails(readFileSync(path.join(ROOT, "data/carriers.json"), "utf8")),
    fileExists: (logical) => existsSync(path.join(SHOWCASE, logical.slice(SHOWCASE_PATH_PREFIX.length))),
  };
});

describe("the committed showcase passes the publication audit", () => {
  beforeEach(() => vi.stubEnv("DAMAGE_DESK_SHOWCASE_DIR", SHOWCASE));
  afterEach(() => vi.unstubAllEnvs());

  it("every case holds only fictitious data and points to files that exist", async () => {
    const cases = await listShowcaseCases();
    expect(cases).toHaveLength(6);
    for (const c of cases) expect(auditShowcaseCase(c, context), c.id).toEqual([]);
  });

  it("every claim PDF holds no real e-mail, key or local path", async () => {
    const cases = await listShowcaseCases();
    const pdfs = cases.flatMap((c) => (c.document ? [c.document.pdfPath] : []));
    expect(pdfs).toHaveLength(2); // the runs that ended with a carrier claim: cases 4 and 5
    for (const logical of pdfs) {
      const bytes = await readFile(path.join(SHOWCASE, logical.slice(SHOWCASE_PATH_PREFIX.length)));
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      const text = pdfText(bytes);
      // The scan really reads the drawn text: the claim says which parcel it is about.
      expect(text).toMatch(/Carrier claim file|Tracking|6A99001001001|99100404|XW9900/i);
      expect(auditText(text, context.allowedEmails, { longTokens: false }), logical).toEqual([]);
    }
  });

  it("the photos, evidence and PDFs listed by the cases are the only binary files in the folder", async () => {
    const listed = new Set((await listShowcaseCases()).flatMap(referencedFiles));
    const onDisk = ["photos", "evidence", "claims"].flatMap((d) => readdirSync(path.join(SHOWCASE, d)).map((n) => `${SHOWCASE_PATH_PREFIX}${d}/${n}`));
    expect(new Set(onDisk)).toEqual(listed);
  });
});

describe("the audit refuses what must not be published", () => {
  const recorded = (over: Partial<CaseRecord> = {}): CaseRecord =>
    makeCase({
      engine: "muse-spark-1.3",
      recorded: { recordedOn: "2026-10-27" },
      report: { ...makeCase().report, photos: [`${SHOWCASE_PATH_PREFIX}photos/vase-broken.webp`] },
      evidence: [],
      document: null,
      order: null,
      ...over,
    });
  const audit = (c: CaseRecord) => auditShowcaseCase(c, context);

  it("accepts a clean recorded case", () => {
    expect(audit(recorded())).toEqual([]);
  });

  it("refuses a mock run, or a case that is not marked recorded", () => {
    expect(audit(recorded({ engine: "demo-mock" })).join()).toMatch(/real Muse Spark 1.3 run/);
    expect(audit(recorded({ recorded: undefined })).join()).toMatch(/recorded\.recordedOn/);
  });

  it("refuses a real-looking e-mail address, but accepts the reserved example domains and the carrier contact", () => {
    const withMail = (email: string) => recorded({ report: { ...recorded().report, customerEmail: email } });
    expect(audit(withMail("jane.doe@gmail.com")).join()).toMatch(/gmail\.com/);
    expect(audit(withMail("a@example.org"))).toEqual([]);
    expect(audit(withMail("claims@maison-demo.example"))).toEqual([]);
    expect(audit(withMail("offrestart@mondialrelay.fr"))).toEqual([]);
    expect(audit(withMail("someone@mondialrelay.com")).join()).toMatch(/mondialrelay\.com/);
  });

  it("refuses keys and tokens, in any shape the stack could leak one", () => {
    for (const leak of [
      "key sk-abcdefghijklmnopqrstuvwxyz0123",
      "Authorization: Bearer abcdefghijklmnop1234",
      "token vercel_blob_rw_abc_def",
      "MODEL_API_KEY was set",
      "-----BEGIN PRIVATE KEY-----",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
      `blob ${"A1b2".repeat(15)}`,
    ]) {
      expect(audit(recorded({ report: { ...recorded().report, message: leak } })), leak).not.toEqual([]);
    }
  });

  it("does not take a long carrier URL or a long path for a token", () => {
    const message = "See https://www.colissimo.entreprise.laposte.fr/sites/default/files/2021-03/cgv-contrat-facilite-et-plus-encore-1234567890.pdf and data/showcase/evidence/9c95a18f6079389a-annotated.jpg";
    expect(audit(recorded({ report: { ...recorded().report, message } }))).toEqual([]);
  });

  it("refuses a path from a developer's machine, the runtime folder and a Contributor model id", () => {
    for (const leak of ["/Users/someone/project/data", "C:\\\\Users\\\\me", "data/runtime/uploads/x.jpg", "muse-spark-1.3-contributor"]) {
      expect(audit(recorded({ report: { ...recorded().report, message: leak } })), leak).not.toEqual([]);
    }
  });

  it("refuses an order that is not, field for field, one of the invented fixtures", () => {
    const fixtureOrder = makeCase().order!;
    expect(audit(recorded({ order: { ...fixtureOrder, id: "#9999" } })).join()).toMatch(/not in data\/fixtures/);
    const real = { ...fixtureOrder, name: "Someone Else", email: "someone.else@example.com", trackingNumber: "6A99001001001" };
    expect(audit(recorded({ order: real })).join()).toMatch(/"name" differs/);
  });

  it("refuses a file that is missing or outside data/showcase", () => {
    const base = recorded();
    expect(audit(recorded({ report: { ...base.report, photos: [`${SHOWCASE_PATH_PREFIX}photos/missing.webp`] } })).join()).toMatch(/missing file/);
    expect(audit(recorded({ report: { ...base.report, photos: ["data/photos/vase-broken.webp"] } })).join()).toMatch(/outside data\/showcase/);
  });
});
