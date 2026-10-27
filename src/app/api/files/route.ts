import { promises as fs } from "node:fs";
import path from "node:path";
import { errorResponse } from "../_lib/responses";
import { resolveRuntimeFile } from "../_lib/runtime-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Images only, and no SVG (an SVG served from our origin could carry script).
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * GET /api/files?p=<path under data/runtime/>: serves uploaded and annotated photos to the
 * case page. Reads only inside data/runtime/ (see resolveRuntimeFile) and only image types.
 */
export async function GET(request: Request): Promise<Response> {
  const requested = new URL(request.url).searchParams.get("p") ?? "";
  const type = CONTENT_TYPES[path.extname(requested).toLowerCase()];
  if (!type) return errorResponse(404, "not_found", "File not found.");
  const file = await resolveRuntimeFile(requested);
  if (!file) return errorResponse(404, "not_found", "File not found.");
  const bytes = await fs.readFile(file);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
