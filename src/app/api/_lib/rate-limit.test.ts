import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_REAL_RUNS_PER_DAY, rateLimit, realRunsPerDay, resetRateLimits, takeRealRun } from "./rate-limit";
import { accessCodeRequired, hasValidAccessCode } from "./access";

beforeEach(() => resetRateLimits());

describe("realRunsPerDay", () => {
  it("defaults when unset, blank (the line copied from .env.example) or invalid", () => {
    expect(realRunsPerDay({})).toBe(DEFAULT_REAL_RUNS_PER_DAY);
    expect(realRunsPerDay({ DAMAGE_DESK_REAL_RUNS_PER_DAY: "" })).toBe(DEFAULT_REAL_RUNS_PER_DAY);
    expect(realRunsPerDay({ DAMAGE_DESK_REAL_RUNS_PER_DAY: "  " })).toBe(DEFAULT_REAL_RUNS_PER_DAY);
    expect(realRunsPerDay({ DAMAGE_DESK_REAL_RUNS_PER_DAY: "lots" })).toBe(DEFAULT_REAL_RUNS_PER_DAY);
    expect(realRunsPerDay({ DAMAGE_DESK_REAL_RUNS_PER_DAY: "-3" })).toBe(DEFAULT_REAL_RUNS_PER_DAY);
  });
  it("reads a number, 0 included (0 switches real runs off)", () => {
    expect(realRunsPerDay({ DAMAGE_DESK_REAL_RUNS_PER_DAY: "25" })).toBe(25);
    expect(realRunsPerDay({ DAMAGE_DESK_REAL_RUNS_PER_DAY: "0" })).toBe(0);
  });
});

describe("takeRealRun: global daily ceiling", () => {
  const noon = Date.parse("2026-11-02T12:00:00Z");
  it("allows the limit, then refuses until the next UTC day", () => {
    expect([1, 2, 3].map(() => takeRealRun(2, noon))).toEqual([true, true, false]);
    expect(takeRealRun(2, noon + 11 * 3_600_000)).toBe(false); // 23:00 the same day
    expect(takeRealRun(2, noon + 13 * 3_600_000)).toBe(true); // 01:00 next day
  });
  it("a limit of 0 refuses everything", () => {
    expect(takeRealRun(0, noon)).toBe(false);
  });
});

describe("rateLimit", () => {
  it("is per key and slides with time", () => {
    const opts = { limit: 2, windowMs: 1000 };
    expect(rateLimit("a", { ...opts, now: 0 }).ok).toBe(true);
    expect(rateLimit("a", { ...opts, now: 10 }).ok).toBe(true);
    expect(rateLimit("a", { ...opts, now: 20 }).ok).toBe(false);
    expect(rateLimit("b", { ...opts, now: 20 }).ok).toBe(true);
    expect(rateLimit("a", { ...opts, now: 1100 }).ok).toBe(true);
  });
});

describe("access code", () => {
  const req = (code?: string) =>
    new Request("http://x", { headers: code === undefined ? {} : { "x-access-code": code } });
  it("is not required when unset or blank", () => {
    expect(accessCodeRequired({})).toBe(false);
    expect(accessCodeRequired({ DAMAGE_DESK_ACCESS_CODE: "  " })).toBe(false);
    expect(hasValidAccessCode(req(), {})).toBe(true);
  });
  it("accepts only the exact code", () => {
    const env = { DAMAGE_DESK_ACCESS_CODE: "s3cret" };
    expect(accessCodeRequired(env)).toBe(true);
    expect(hasValidAccessCode(req("s3cret"), env)).toBe(true);
    expect(hasValidAccessCode(req(" s3cret "), env)).toBe(true);
    expect(hasValidAccessCode(req("s3cre"), env)).toBe(false);
    expect(hasValidAccessCode(req("S3CRET"), env)).toBe(false);
    expect(hasValidAccessCode(req(""), env)).toBe(false);
    expect(hasValidAccessCode(req(), env)).toBe(false);
  });
});
