import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { DecisionKind } from "../types";
import type { EvalCaseResult, EvalExpectation, EvalResults, EvalRun } from "./types";

// Reading and validating the committed evaluations (data/eval/*.json). The file is ours, but it is
// parsed like input: a half-written or hand-edited file must fail loudly with the name of the
// field, not render a page that looks fine and says something else.

const DECISIONS: readonly DecisionKind[] = ["reship", "refund", "ask_more_photos", "no_action"];
const ENGINES = ["muse-spark-1.3", "open-weights", "openrouter"] as const;

/** Where the committed results live. DAMAGE_DESK_EVAL_DIR lets a test point at a fixture folder. */
export function evalDir(env: Record<string, string | undefined> = process.env): string {
  return env.DAMAGE_DESK_EVAL_DIR || path.join(process.cwd(), "data", "eval");
}

type Obj = Record<string, unknown>;

function fail(where: string, what: string): never {
  throw new Error(`Invalid evaluation file: ${where} ${what}`);
}
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
function num(o: Obj, key: string, where: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${where}.${key}`, "must be a number");
  return v;
}
function bool(o: Obj, key: string, where: string): boolean {
  if (typeof o[key] !== "boolean") fail(`${where}.${key}`, "must be a boolean");
  return o[key] as boolean;
}
function str(o: Obj, key: string, where: string): string {
  if (typeof o[key] !== "string") fail(`${where}.${key}`, "must be a string");
  return o[key] as string;
}
function nullable<T>(o: Obj, key: string, where: string, check: (v: unknown) => v is T, label: string): T | null {
  const v = o[key];
  if (v === null) return null;
  if (!check(v)) fail(`${where}.${key}`, `must be ${label} or null`);
  return v;
}
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isStr = (v: unknown): v is string => typeof v === "string";
const isDecision = (v: unknown): v is DecisionKind => DECISIONS.includes(v as DecisionKind);
function strings(o: Obj, key: string, where: string): string[] {
  const v = o[key];
  if (!Array.isArray(v) || !v.every(isStr)) fail(`${where}.${key}`, "must be a list of strings");
  return v;
}

function parseExpectation(raw: unknown, where: string): EvalExpectation {
  if (!isObj(raw)) return fail(where, "must be an object");
  const acceptable = raw.acceptableDecisions;
  if (!Array.isArray(acceptable) || acceptable.length === 0 || !acceptable.every(isDecision)) {
    fail(`${where}.acceptableDecisions`, "must be a non-empty list of decisions");
  }
  const decision = raw.decision;
  if (!isDecision(decision) || !acceptable.includes(decision)) fail(`${where}.decision`, "must be one of acceptableDecisions");
  return {
    decision,
    acceptableDecisions: acceptable,
    carrierClaim: bool(raw, "carrierClaim", where),
    needsHuman: bool(raw, "needsHuman", where),
    claimEligible: bool(raw, "claimEligible", where),
  };
}

function parseRun(raw: unknown, where: string): EvalRun {
  if (!isObj(raw)) return fail(where, "must be an object");
  const sam = raw.sam;
  if (!isObj(sam)) return fail(`${where}.sam`, "must be an object");
  if (sam.method !== "sam-3.1" && sam.method !== "none") fail(`${where}.sam.method`, 'must be "sam-3.1" or "none"');
  const matches = raw.matches;
  if (!isObj(matches)) return fail(`${where}.matches`, "must be an object");
  let usage: EvalRun["usage"] = null;
  if (raw.usage !== null) {
    if (!isObj(raw.usage)) fail(`${where}.usage`, "must be an object or null");
    const u = raw.usage;
    usage = {
      promptTokens: num(u, "promptTokens", `${where}.usage`),
      completionTokens: num(u, "completionTokens", `${where}.usage`),
      totalTokens: num(u, "totalTokens", `${where}.usage`),
      cachedTokens: num(u, "cachedTokens", `${where}.usage`),
      callsWithUsage: num(u, "callsWithUsage", `${where}.usage`),
    };
  }
  return {
    run: num(raw, "run", where),
    completed: bool(raw, "completed", where),
    failure: nullable(raw, "failure", where, isStr, "a string"),
    decision: nullable(raw, "decision", where, isDecision, "a decision"),
    carrierClaim: nullable(raw, "carrierClaim", where, isBool, "a boolean"),
    needsHuman: nullable(raw, "needsHuman", where, isBool, "a boolean"),
    claimEligible: nullable(raw, "claimEligible", where, isBool, "a boolean"),
    claimAmountEur: nullable(raw, "claimAmountEur", where, isNum, "a number"),
    claimDocument: bool(raw, "claimDocument", where),
    confidence: nullable(raw, "confidence", where, isNum, "a number"),
    guardrails: strings(raw, "guardrails", where),
    reasons: strings(raw, "reasons", where),
    sam: {
      method: sam.method,
      regions: num(sam, "regions", `${where}.sam`),
      concepts: strings(sam, "concepts", `${where}.sam`),
      calledByCode: bool(sam, "calledByCode", `${where}.sam`),
      requests: num(sam, "requests", `${where}.sam`),
    },
    durationMs: num(raw, "durationMs", where),
    modelCalls: num(raw, "modelCalls", where),
    toolCalls: num(raw, "toolCalls", where),
    usage,
    matches: {
      decision: bool(matches, "decision", `${where}.matches`),
      carrierClaim: bool(matches, "carrierClaim", `${where}.matches`),
      needsHuman: bool(matches, "needsHuman", `${where}.matches`),
      claimEligible: bool(matches, "claimEligible", `${where}.matches`),
      all: bool(matches, "all", `${where}.matches`),
    },
  };
}

function parseCase(raw: unknown, where: string): EvalCaseResult {
  if (!isObj(raw)) return fail(where, "must be an object");
  const runs = raw.runs;
  if (!Array.isArray(runs) || runs.length === 0) return fail(`${where}.runs`, "must be a non-empty list");
  return {
    id: str(raw, "id", where),
    title: str(raw, "title", where),
    expected: parseExpectation(raw.expected, `${where}.expected`),
    runs: runs.map((r, i) => parseRun(r, `${where}.runs[${i}]`)),
  };
}

/** Validate a parsed JSON value as an evaluation. Throws an Error naming the first bad field. */
export function parseEvalResults(raw: unknown): EvalResults {
  if (!isObj(raw)) return fail("file", "must be a JSON object");
  if (raw.schemaVersion !== 1) fail("schemaVersion", "must be 1");
  const engine = raw.engine;
  // A mock run is never an evaluation: the file would present a script as a measurement.
  if (!ENGINES.includes(engine as (typeof ENGINES)[number])) fail("engine", `must be one of ${ENGINES.join(", ")}`);
  const cases = raw.cases;
  if (!Array.isArray(cases) || cases.length === 0) return fail("cases", "must be a non-empty list");
  let pricing: EvalResults["pricing"] = null;
  if (raw.pricing !== null) {
    if (!isObj(raw.pricing)) fail("pricing", "must be an object or null");
    const p = raw.pricing;
    pricing = {
      inputPerMillionTokensUsd: num(p, "inputPerMillionTokensUsd", "pricing"),
      outputPerMillionTokensUsd: num(p, "outputPerMillionTokensUsd", "pricing"),
      samPerRequestUsd: num(p, "samPerRequestUsd", "pricing"),
      source: str(p, "source", "pricing"),
    };
  }
  const generatedAt = str(raw, "generatedAt", "file");
  if (Number.isNaN(Date.parse(generatedAt))) fail("generatedAt", "must be an ISO date-time");
  return {
    schemaVersion: 1,
    generatedAt,
    engine: engine as EvalResults["engine"],
    model: str(raw, "model", "file"),
    engineLabel: str(raw, "engineLabel", "file"),
    runsPerCase: num(raw, "runsPerCase", "file"),
    command: str(raw, "command", "file"),
    commit: nullable(raw, "commit", "file", isStr, "a string"),
    dirty: bool(raw, "dirty", "file"),
    pricing,
    estimatedCostUsd: nullable(raw, "estimatedCostUsd", "file", isNum, "a number"),
    cases: cases.map((c, i) => parseCase(c, `cases[${i}]`)),
  };
}

export interface LoadedEval {
  results: EvalResults;
  /** File name inside the evaluation folder. */
  file: string;
}

/** Every committed evaluation, newest first. Throws when a file is unreadable or invalid. */
export function loadEvalResults(dir: string = evalDir()): LoadedEval[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch (error) {
    // No folder at all is "nothing committed yet", not a failure.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((file) => {
      try {
        return { file, results: parseEvalResults(JSON.parse(readFileSync(path.join(dir, file), "utf8"))) };
      } catch (error) {
        throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
    .sort((a, b) => Date.parse(b.results.generatedAt) - Date.parse(a.results.generatedAt));
}

/** The most recent committed evaluation, or null when there is none. */
export function loadLatestEval(dir: string = evalDir()): LoadedEval | null {
  return loadEvalResults(dir)[0] ?? null;
}
