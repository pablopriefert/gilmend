// Prepares agent trace payloads for display. A trace step can carry a whole photo as a data
// URL or a long model answer; showing that raw would freeze the page, so long strings are
// shortened and deep structures are cut off.

const MAX_STRING = 300;
const MAX_ITEMS = 25;
const MAX_DEPTH = 6;

export function sanitizeForDisplay(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.length <= MAX_STRING) return value;
    const head = value.startsWith("data:") ? value.slice(0, 40) : value.slice(0, MAX_STRING);
    return `${head}… (${value.length} characters)`;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "… (nested too deep to show)";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => sanitizeForDisplay(v, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`… (${value.length - MAX_ITEMS} more items)`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = sanitizeForDisplay(v, depth + 1);
  }
  return out;
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(sanitizeForDisplay(value), null, 2) ?? "undefined";
  } catch {
    return "(not displayable)";
  }
}

export type NoteFlag = "unverified" | "dated_source" | null;

/**
 * Carrier-rule notes carry a verification tag, written by whoever maintains the rules:
 * "UNVERIFIED:" or "[D]" / "[NP]" (deduced / not public) in front, "DATED SOURCE:" for a
 * figure read in an older edition, or the word UNVERIFIED somewhere in the sentence. The tag
 * becomes a flag in the UI and is stripped from the text.
 */
export function noteVerification(note: string): { text: string; flag: NoteFlag } {
  const capitalise = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
  const unverifiedTag = /^\s*(?:\[(?:D|NP|unverified)\]|unverified\s*[:\-–])\s*/i.exec(note);
  if (unverifiedTag) return { text: capitalise(note.slice(unverifiedTag[0].length)), flag: "unverified" };
  const datedTag = /^\s*dated source\s*[:\-–]\s*/i.exec(note);
  if (datedTag) return { text: capitalise(note.slice(datedTag[0].length)), flag: "dated_source" };
  if (/\bunverified\b/i.test(note)) return { text: note, flag: "unverified" };
  return { text: note, flag: null };
}

/** True when a source was last checked more than `maxAgeDays` before `now`. */
export function isStaleSource(checkedOn: string, now: Date, maxAgeDays = 60): boolean {
  const t = Date.parse(checkedOn);
  if (Number.isNaN(t)) return true;
  return (now.getTime() - t) / 86_400_000 > maxAgeDays;
}
