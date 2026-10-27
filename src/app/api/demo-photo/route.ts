import { promises as fs } from "node:fs";
import path from "node:path";
import { sniffMime } from "@/lib/agent/photos";
import { resolveDemoPhoto } from "@/lib/store/demo-photos";
import { errorResponse } from "../_lib/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The photos of the six demo cases, for the demo buttons of the report form. Only these six
// names are served (never a path taken from the request), read from data/photos/.
const DEMO_PHOTO_NAMES = [
  "vase-broken",
  "carton-crushed",
  "lamp-blurry",
  "parcel-open-missing",
  "headphones-cracked",
  "carafe-cracked",
] as const;

/**
 * GET /api/demo-photo?name=vase-broken: the demo photo (the one we shot, else the provisional
 * stand-in), with the content type read from its bytes. 404 for any other name.
 */
export async function GET(request: Request): Promise<Response> {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!(DEMO_PHOTO_NAMES as readonly string[]).includes(name)) {
    return errorResponse(404, "not_found", "Unknown demo photo.");
  }
  const file = resolveDemoPhoto(path.join("data", "photos", `${name}.jpg`));
  if (!file) return errorResponse(404, "not_found", "This demo photo is not on the server.");
  const bytes = await fs.readFile(/*turbopackIgnore: true*/ file);
  const type = sniffMime(bytes);
  if (!type) return errorResponse(404, "not_found", "This demo photo is not a readable image.");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
