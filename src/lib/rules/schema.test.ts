import { describe, expect, it } from "vitest";
import carriersFile from "../../../data/carriers.json";
import { validateCarrierRulesFile } from "./schema";

// The validator is the safety net for hand edits of data/carriers.json: a wrong deadline
// or a missing source must fail here, not turn into a wrong claim in the PDF.
const clone = () => structuredClone(carriersFile) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("validateCarrierRulesFile", () => {
  it("accepts the shipped file", () => {
    expect(() => validateCarrierRulesFile(carriersFile)).not.toThrow();
  });

  it("rejects a carrier without sources", () => {
    const f = clone();
    f.carriers.chronopost.sources = [];
    expect(() => validateCarrierRulesFile(f)).toThrow(/carriers\.chronopost\.sources/);
  });

  it("rejects a negative deadline", () => {
    const f = clone();
    f.carriers.mondial_relay.reserveDeadlineHours = -1;
    expect(() => validateCarrierRulesFile(f)).toThrow(/reserveDeadlineHours/);
  });

  it("rejects a missing carrier", () => {
    const f = clone();
    delete f.carriers.colissimo;
    expect(() => validateCarrierRulesFile(f)).toThrow(/carriers\.colissimo/);
  });

  it("rejects a compensation without per-kg or flat amount", () => {
    const f = clone();
    f.carriers.colissimo.compensation = { capEur: 690 };
    expect(() => validateCarrierRulesFile(f)).toThrow(/needs perKgEur or flatEur/);
  });

  it("rejects an unknown figure status and a non-https source", () => {
    const a = clone();
    a.carriers.colissimo.figures[0].status = "probably";
    expect(() => validateCarrierRulesFile(a)).toThrow(/status/);
    const b = clone();
    b.carriers.colissimo.sources[0].url = "http://example.com";
    expect(() => validateCarrierRulesFile(b)).toThrow(/expected https/);
  });

  it("rejects a variant with a broken pattern", () => {
    const f = clone();
    f.carriers.chronopost.compensationVariants[0].when.itemPattern = "(";
    expect(() => validateCarrierRulesFile(f)).toThrow(/regular expression/);
  });

  it("rejects a source without a check date", () => {
    const f = clone();
    f.carriers.colissimo.sources[0].checkedOn = "yesterday";
    expect(() => validateCarrierRulesFile(f)).toThrow(/YYYY-MM-DD/);
  });
  it("rejects a carrier without a domestic scope, or with spellings that cannot match", () => {
    const a = clone();
    delete a.carriers.gls.domestic;
    expect(() => validateCarrierRulesFile(a)).toThrow(/carriers\.gls\.domestic/);
    const b = clone();
    b.carriers.dhl_paket.domestic.aliases = [];
    expect(() => validateCarrierRulesFile(b)).toThrow(/at least one spelling/);
    const c = clone();
    c.carriers.dhl_paket.domestic.aliases = ["DE"];
    expect(() => validateCarrierRulesFile(c)).toThrow(/lowercase/);
    const d = clone();
    d.carriers.colissimo.domestic.name = "";
    expect(() => validateCarrierRulesFile(d)).toThrow(/domestic\.name/);
  });

  it("requires the two German carriers", () => {
    const f = clone();
    delete f.carriers.dhl_paket;
    expect(() => validateCarrierRulesFile(f)).toThrow(/carriers\.dhl_paket/);
  });
});
