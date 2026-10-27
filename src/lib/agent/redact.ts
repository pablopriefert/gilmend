// Keeps CaseRecord.trace readable and small: photos are data URLs of hundreds of kB and
// must never be copied into the trace (or into logs).
export function redactForTrace(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) return `[data URL omitted, ${value.length} chars]`;
    return value.length > 1500 ? `${value.slice(0, 1500)}... [${value.length} chars]` : value;
  }
  if (depth > 6) return "[nested value omitted]";
  if (Array.isArray(value)) return value.map((v) => redactForTrace(v, depth + 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactForTrace(v, depth + 1)]),
    );
  }
  return value;
}
