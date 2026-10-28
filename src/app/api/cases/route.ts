import { toPublicCases } from "@/lib/public-case";
import { listCases } from "@/lib/store/cases";
import { summarizeCases } from "@/lib/store/summary";
import { failureResponse } from "../_lib/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cases: every case, newest first, plus the numbers for the header counter. File locations
 * are app references, never server paths (src/lib/public-case.ts).
 */
export async function GET(): Promise<Response> {
  try {
    const cases = await listCases();
    return Response.json(
      { cases: toPublicCases(cases), summary: summarizeCases(cases, new Date()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return failureResponse(err, "Listing cases");
  }
}
