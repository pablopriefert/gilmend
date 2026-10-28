"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileCheck2, LoaderCircle, TriangleAlert, Undo2 } from "lucide-react";
import { useReviewAccess } from "../case-review-panel";
import { accessHeaders } from "../access-code";
import { formatDateTime } from "../format";
import { BUTTON_QUIET, riseStyle } from "./ui";

/**
 * The merchant's own note that they filed the carrier claim (29 Oct 2026, `claimFiledAt`), with the way
 * back: a mistaken click is undone here or in the Today panel. Gilmend files nothing, and the card says
 * so. Must be inside a CaseReviewProvider (it shares the access code typed for the page).
 */
export function ClaimFiledNote({ caseId, filedAt }: { caseId: string; filedAt: string }) {
  const router = useRouter();
  const access = useReviewAccess();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function undo(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...accessHeaders(access.accessCode) },
        body: JSON.stringify({ claimFiled: false }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (res.status === 401 && data?.error === "access_code_required") access.setCodeRefused(true);
      if (!res.ok) {
        setError(data?.message ?? "The note could not be cleared.");
        return;
      }
      access.setCodeRefused(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="claim-filed-note"
      style={riseStyle(2)}
      className="animate-rise flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card"
    >
      <p className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-soft">
        <FileCheck2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
        <span>
          <strong className="font-semibold text-ink">
            Claim marked as filed by you on <span className="tabular">{formatDateTime(filedAt)}</span>.
          </strong>{" "}
          Gilmend filed nothing: this is only your note, and it stops the morning reminder.
        </span>
      </p>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          {error}
        </p>
      )}
      <div>
        <button type="button" className={BUTTON_QUIET} disabled={busy} onClick={() => void undo()}>
          {busy ? (
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:hidden" strokeWidth={2} />
          ) : (
            <Undo2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          )}
          Undo: I did not file it
        </button>
      </div>
    </section>
  );
}
