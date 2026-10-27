import demoFile from "../../../data/demo-cases.json";
import type { DamageReport, DecisionKind } from "../types";
import { isProvisionalDemoPhoto, resolveDemoPhoto } from "./demo-photos";

// The six filmable cases of the spec (data/demo-cases.json). Times are offsets from "now"
// so a case reported "3 hours ago" is still 3 hours old on demo day, and stays consistent
// with the order fixtures (delivery times are relative too).

export interface DemoExpectation {
  /** Primary expected decision. */
  decision: DecisionKind;
  /** Decisions we would also accept from the model (the merchant policy can go either way). */
  acceptableDecisions: DecisionKind[];
  carrierClaim: boolean;
  needsHuman: boolean;
  /** Whether computeClaim should call the claim eligible at report time. */
  claimEligible: boolean;
  rationale: string;
}

export interface DemoCase {
  id: string;
  title: string;
  report: DamageReport;
  expected: DemoExpectation;
}

const HOUR_MS = 3_600_000;
const DECISIONS: readonly DecisionKind[] = ["reship", "refund", "ask_more_photos", "no_action"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function bad(id: string, message: string): never {
  throw new Error(`Invalid demo case "${id}": ${message}`);
}

/** Validates the raw JSON and resolves each case's report against `now`. */
export function parseDemoCases(raw: unknown, now: Date = new Date()): DemoCase[] {
  const list = isRecord(raw) ? raw.cases : raw;
  if (!Array.isArray(list)) throw new Error("Demo cases file must contain a 'cases' array");
  const seen = new Set<string>();

  return list.map((entry): DemoCase => {
    if (!isRecord(entry)) throw new Error("Demo case is not an object");
    const id = entry.id;
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) throw new Error("Demo case id invalid");
    if (seen.has(id)) bad(id, "duplicate id");
    seen.add(id);

    for (const key of ["title", "customerEmail", "orderNumber", "message", "language"] as const) {
      if (typeof entry[key] !== "string" || (entry[key] as string).trim() === "") {
        bad(id, `"${key}" must be a non-empty string`);
      }
    }
    const photos = entry.photos;
    if (
      !Array.isArray(photos) ||
      photos.length < 1 ||
      photos.length > 3 ||
      !photos.every((p) => typeof p === "string" && /^data\/photos\/[a-z0-9-]+\.jpg$/.test(p))
    ) {
      bad(id, "photos must be 1 to 3 paths like data/photos/<name>.jpg");
    }
    const hours = entry.reportedHoursAgo;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0) {
      bad(id, "reportedHoursAgo must be a number >= 0");
    }

    const exp = entry.expected;
    if (!isRecord(exp)) return bad(id, "expected missing");
    const decision = exp.decision as DecisionKind;
    const acceptable = exp.acceptableDecisions as DecisionKind[];
    if (
      !DECISIONS.includes(decision) ||
      !Array.isArray(acceptable) ||
      !acceptable.includes(decision) ||
      !acceptable.every((d) => DECISIONS.includes(d))
    ) {
      bad(id, "expected.decision must be one of acceptableDecisions, all valid decisions");
    }
    for (const key of ["carrierClaim", "needsHuman", "claimEligible"] as const) {
      if (typeof exp[key] !== "boolean") bad(id, `expected.${key} must be a boolean`);
    }
    if (typeof exp.rationale !== "string") bad(id, "expected.rationale missing");

    return {
      id,
      title: entry.title as string,
      report: {
        id,
        receivedAt: new Date(now.getTime() - (hours as number) * HOUR_MS).toISOString(),
        customerEmail: entry.customerEmail as string,
        orderNumber: entry.orderNumber as string,
        message: entry.message as string,
        photos: photos as string[],
        language: entry.language as string,
      },
      expected: {
        decision,
        acceptableDecisions: acceptable,
        carrierClaim: exp.carrierClaim as boolean,
        needsHuman: exp.needsHuman as boolean,
        claimEligible: exp.claimEligible as boolean,
        rationale: exp.rationale as string,
      },
    };
  });
}

/** The six demo cases with report times relative to `now`. */
export function loadDemoCases(now: Date = new Date()): DemoCase[] {
  return parseDemoCases(demoFile, now);
}

/**
 * Photos that are referenced by the demo cases and exist in no version, not even as a
 * provisional stand-in (see data/photos/README.md). `root` is the repository root; paths in
 * the cases are relative to it.
 */
export function missingDemoPhotos(
  root: string = process.cwd(),
  cases: DemoCase[] = loadDemoCases(),
): string[] {
  return cases.flatMap((c) => c.report.photos).filter((photo) => resolveDemoPhoto(photo, root) === null);
}

/**
 * Photos that are only a provisional AI-generated stand-in: the photo we shoot ourselves is
 * still to come (the hackathon wants photos taken by the team, and the README says so).
 */
export function provisionalDemoPhotos(
  root: string = process.cwd(),
  cases: DemoCase[] = loadDemoCases(),
): string[] {
  return cases
    .flatMap((c) => c.report.photos)
    .filter((photo) => {
      const file = resolveDemoPhoto(photo, root);
      return file !== null && isProvisionalDemoPhoto(file);
    });
}
