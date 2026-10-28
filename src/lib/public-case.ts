import { photoSrc } from "@/components/photo-src";
import type { StreamEvent } from "@/lib/agent/events";
import { runtimeDir } from "@/lib/runtime-dir";
import type { CaseRecord, ClaimDocument, Evidence, FollowUp, PreviousRound } from "@/lib/types";

// What leaves the server (28 Oct 2026). A stored case keeps file locations as the machine knows them:
// "/tmp/damage-desk/uploads/rpt-1/photo-1.jpg" on Vercel, "data/runtime/..." locally. A production
// validation found GET /api/cases/<id> returning them as they are: the layout of the server's disk,
// of no use to anyone and a free map for whoever probes the instance.
//
// The mapping is done HERE, at the response boundary, and nowhere else: the store, the PDF route
// (which resolves `document.pdfPath` from the stored record), the showcase, the eval page and every
// case already saved keep working untouched. A path in a response is one of:
//   - an app-relative URL the UI can use as it is: `/api/files?p=...` for a photo or an outline,
//     `/api/demo-photo?name=...`, `/api/cases/<id>/pdf` for the current claim PDF;
//   - a logical path relative to the runtime folder (`claims/case-1.pdf`, `uploads/rpt-1/photo-1.jpg`)
//     where no route serves the file (a PDF of an earlier round, a path quoted in the trace).
// Data URLs and http(s) addresses are not server paths and are left as they are. The mapping is
// idempotent: a record that was already mapped comes out unchanged.

const TMP_RUNTIME = /(?:[A-Za-z]:)?[^\s"'`()<>]*?\/damage-desk\/((?:uploads|evidence|claims)\/[^\s"'`()<>]+)/g;
const PROJECT_RUNTIME = /(^|[\s"'`(])(?:\.\/)?data\/runtime\//g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A text with the server's folders taken out: "/tmp/damage-desk/claims/x.pdf" becomes "claims/x.pdf",
 * the runtime folder and the project folder disappear from any message that quoted a path (a failed
 * read in the trace, say). Text without a server path comes back identical.
 */
export function scrubServerPaths(text: string): string {
  if (!text.includes("/") && !text.includes("\\")) return text;
  let out = text.replace(TMP_RUNTIME, "$1");
  out = out.replace(PROJECT_RUNTIME, "$1");
  for (const root of [runtimeDir(), process.cwd()]) {
    const clean = root.replaceAll("\\", "/").replace(/\/+$/, "");
    if (clean.length > 1) out = out.replace(new RegExp(`${escapeRegExp(clean)}/`, "g"), "");
  }
  return out;
}

/** The part of a stored path that is relative to the runtime folder (or to data/showcase, kept as "showcase/..."). */
export function logicalPath(stored: string): string {
  const p = stored.trim().replaceAll("\\", "/");
  if (p === "" || /^data:/i.test(p) || /^https?:\/\//i.test(p)) return p;
  const showcase = p.indexOf("data/showcase/");
  if (showcase !== -1) return `showcase/${p.slice(showcase + "data/showcase/".length)}`;
  const scrubbed = scrubServerPaths(p);
  // Still absolute: a place this app does not know. Only the file name is kept.
  if (scrubbed.startsWith("/") || /^[A-Za-z]:\//.test(scrubbed)) return scrubbed.split("/").pop() ?? "";
  return scrubbed;
}

/** A stored photo or outline as the browser can load it: a URL of this app, never a server path. */
export function publicPhoto(stored: string): string {
  const p = stored.trim();
  if (p === "") return p;
  if (/^data:/i.test(p) || /^https?:\/\//i.test(p)) return p;
  // Already an app address (a mapped record, or a static asset of public/): keep it.
  if (/^\/(?:api|demo|3d)\//.test(p)) return p;
  const url = photoSrc(p);
  // photoSrc hands back an unknown absolute path as it is: not one to publish.
  if (url !== "" && !(url.startsWith("/") && url === p.replaceAll("\\", "/"))) return url;
  const logical = logicalPath(p);
  return logical === "" ? "" : `/api/files?p=${encodeURIComponent(logical)}`;
}

function publicEvidence(items: Evidence[] | undefined): Evidence[] {
  return (items ?? []).map((e) => ({
    ...e,
    photo: publicPhoto(e.photo),
    annotatedPhoto: e.annotatedPhoto === null || e.annotatedPhoto === undefined ? null : publicPhoto(e.annotatedPhoto),
  }));
}

/** Every string of a value that is not a stored path field, with the server's folders taken out. */
function scrubDeep<T>(value: T): T {
  if (typeof value === "string") return scrubServerPaths(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubDeep(v);
    return out as T;
  }
  return value;
}

function publicDocument(doc: ClaimDocument | null, caseId: string, current: boolean): ClaimDocument | null {
  if (!doc) return doc;
  return {
    ...doc,
    // The current PDF has a route; an earlier round's PDF has none, its logical path says where it is.
    pdfPath: current ? `/api/cases/${encodeURIComponent(caseId)}/pdf` : logicalPath(doc.pdfPath),
  };
}

/**
 * The case as the public JSON routes and the pages send it. Same shape as CaseRecord, so the UI
 * reads it unchanged: only the places that held a server path hold an app reference now.
 */
export function toPublicCase(c: CaseRecord): CaseRecord {
  // The fields that hold a stored path are rebuilt below; everything else only loses the server's
  // folders from its text (a trace line that quoted a path, an integrity note).
  const { report, evidence, document, followUps, previousRounds, ...rest } = c;
  const out: CaseRecord = {
    ...scrubDeep(rest),
    report: { ...scrubDeep({ ...report, photos: [] as string[] }), photos: report.photos.map(publicPhoto) },
    evidence: publicEvidence(evidence),
    document: publicDocument(document, c.id, true),
  };
  if (followUps) {
    out.followUps = followUps.map(
      (f): FollowUp => ({ ...scrubDeep({ ...f, photos: [] as string[] }), photos: f.photos.map(publicPhoto) }),
    );
  }
  if (previousRounds) {
    out.previousRounds = previousRounds.map(
      (r): PreviousRound => ({
        ...scrubDeep({ ...r, evidence: [] as Evidence[], document: null }),
        evidence: publicEvidence(r.evidence),
        document: publicDocument(r.document, c.id, false),
      }),
    );
  }
  return out;
}

export function toPublicCases(cases: CaseRecord[]): CaseRecord[] {
  return cases.map(toPublicCase);
}

/** A live-run event without the stored path of the outline: the page loads the picture from /api/files. */
export function toPublicStreamEvent(event: StreamEvent): StreamEvent {
  if (event.type !== "tool_end" || !event.result || event.result.tool !== "mark_damage") return event;
  const { annotatedPath } = event.result;
  return {
    ...event,
    result: { ...event.result, annotatedPath: annotatedPath === null ? null : publicPhoto(annotatedPath) },
  };
}
