/** JSON error with a stable shape: `{ error: code, message, ...extra }`. */
export function errorResponse(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Ids are used in URLs and by the store: keep them to a harmless alphabet. */
const CASE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
export function isValidCaseId(id: string): boolean {
  return CASE_ID_RE.test(id);
}

/**
 * Turn an unexpected error from a lib module into a response: a generic 500, and the details
 * go to the server log only (never to the browser).
 */
export function failureResponse(err: unknown, what: string): Response {
  console.error(`[gilmend] ${what} failed:`, err instanceof Error ? err.message : err);
  return errorResponse(500, "internal_error", `${what} failed. Check the server log.`);
}
