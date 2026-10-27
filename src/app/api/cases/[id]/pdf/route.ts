import { promises as fs } from "node:fs";
import { buildClaimDocument } from "@/lib/documents/claim-pdf";
import { getCase, updateCase } from "@/lib/store/cases";
import { errorResponse, failureResponse, isValidCaseId } from "../../../_lib/responses";
import { resolveRuntimeFile } from "../../../_lib/runtime-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/cases/[id]/pdf: the carrier claim PDF. Inline by default (the case page embeds
 * it); add `?download=1` for a download. If the case has no PDF on disk yet but a claim is
 * due, it is generated on the spot.
 */
export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { id } = await params;
  if (!isValidCaseId(id)) return errorResponse(404, "not_found", "Case not found.");

  try {
    const found = await getCase(id);
    if (!found) return errorResponse(404, "not_found", "Case not found.");

    let file = found.document ? await resolveRuntimeFile(found.document.pdfPath) : null;
    if (!file) {
      if (!found.decision?.carrierClaim) {
        return errorResponse(404, "no_claim_document", "This case has no carrier claim, so there is no PDF.");
      }
      const document = await buildClaimDocument(found);
      await updateCase(id, { document });
      file = await resolveRuntimeFile(document.pdfPath);
      if (!file) return errorResponse(500, "pdf_missing", "The claim PDF could not be found after generating it.");
    }

    const bytes = await fs.readFile(file);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="claim-${id}.pdf"`,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return failureResponse(err, "Building the claim PDF");
  }
}
