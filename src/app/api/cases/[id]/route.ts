import { getCase, updateCase } from "@/lib/store/cases";
import type { CaseRecord, CaseStatus, TraceStep } from "@/lib/types";
import { requireAccessCode } from "../../_lib/access";
import { errorResponse, failureResponse, isValidCaseId } from "../../_lib/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** The only statuses a human can set. "sent_to_customer" is deliberately absent: nothing is ever sent. */
const SETTABLE_STATUSES: readonly CaseStatus[] = ["needs_review", "approved", "rejected"];
const MAX_REPLY_CHARS = 4000;

const NOCACHE = { "Cache-Control": "no-store" };

/** GET /api/cases/[id]: one case, or 404. */
export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const { id } = await params;
  if (!isValidCaseId(id)) return errorResponse(404, "not_found", "Case not found.");
  try {
    const found = await getCase(id);
    if (!found) return errorResponse(404, "not_found", "Case not found.");
    return Response.json({ case: found }, { headers: NOCACHE });
  } catch (err) {
    return failureResponse(err, "Loading the case");
  }
}

/**
 * PATCH /api/cases/[id]: the human's actions on a case.
 * Body: `{ status?: "approved" | "rejected" | "needs_review", customerReply?: string }`.
 * Approving only marks the case approved ("ready to send"); nothing is sent to a carrier or
 * a customer. Editing replaces the drafted customer reply. Every change is added to the trace.
 * When DAMAGE_DESK_ACCESS_CODE is set, the `x-access-code` header must carry it (else 401, and
 * 429 after too many wrong codes).
 */
export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  const { id } = await params;
  if (!isValidCaseId(id)) return errorResponse(404, "not_found", "Case not found.");
  // On a public deployment (DAMAGE_DESK_ACCESS_CODE set) any visitor could approve, reject or
  // rewrite the reply of any case: changing one needs the shared demo code.
  const refused = requireAccessCode(request, "Enter the access code of this demo to change a case.");
  if (refused) return refused;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Send a JSON body.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse(400, "invalid_body", "The body must be a JSON object.");
  }
  const { status, customerReply } = body as { status?: unknown; customerReply?: unknown };

  if (status === undefined && customerReply === undefined) {
    return errorResponse(400, "invalid_body", "Nothing to change: send `status` and/or `customerReply`.");
  }
  if (status !== undefined && !SETTABLE_STATUSES.includes(status as CaseStatus)) {
    return errorResponse(
      400,
      "invalid_status",
      `Status must be one of ${SETTABLE_STATUSES.join(", ")}. Nothing is ever sent, so "sent_to_customer" cannot be set.`,
    );
  }
  let reply: string | undefined;
  if (customerReply !== undefined) {
    if (typeof customerReply !== "string" || customerReply.trim() === "") {
      return errorResponse(400, "invalid_reply", "The customer reply cannot be empty.");
    }
    if (customerReply.length > MAX_REPLY_CHARS) {
      return errorResponse(400, "invalid_reply", `The customer reply is too long (max ${MAX_REPLY_CHARS} characters).`);
    }
    reply = customerReply.trim();
  }

  try {
    const current = await getCase(id);
    if (!current) return errorResponse(404, "not_found", "Case not found.");
    // Without a decision (the agent failed) there is nothing to approve or to edit, but the
    // human can still dismiss the case.
    if (!current.decision && (status === "approved" || reply !== undefined)) {
      return errorResponse(409, "no_decision", "This case has no decision yet: there is nothing to approve or edit.");
    }

    const now = new Date().toISOString();
    // Only the lines this request adds: the store appends them to the trace it reads under
    // its lock, so a concurrent change from another tab keeps its own line.
    const added: TraceStep[] = [];
    const patch: Partial<Omit<CaseRecord, "id">> = {};

    if (current.decision && reply !== undefined && reply !== current.decision.customerReply) {
      patch.decision = { ...current.decision, customerReply: reply };
      added.push({ step: "Merchant edited the customer reply.", at: now });
    }
    if (status !== undefined && status !== current.status) {
      patch.status = status as CaseStatus;
      added.push({
        step:
          status === "approved"
            ? "Merchant approved the case. Ready to send; nothing was sent."
            : status === "rejected"
              ? "Merchant rejected the case. Nothing was sent."
              : "Merchant reopened the case for review.",
        at: now,
      });
    }
    if (Object.keys(patch).length === 0) {
      return Response.json({ case: current }, { headers: NOCACHE });
    }
    const updated = await updateCase(id, patch, { appendTrace: added });
    return Response.json({ case: updated }, { headers: NOCACHE });
  } catch (err) {
    return failureResponse(err, "Updating the case");
  }
}
