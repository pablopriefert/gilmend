"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import type { CaseRecord, CaseStatus } from "@/lib/types";
import { AccessCodeField, accessHeaders, useAccessCode } from "./access-code";
import { languageName } from "./format";

type Pending = "approve" | "reject" | "reopen" | "save" | null;

const PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY =
  "rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-background disabled:cursor-not-allowed disabled:opacity-60";
const DANGER =
  "rounded-md border border-danger/50 bg-surface px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The human's part: read and edit the drafted customer reply, then Approve, Edit or Reject.
 * Approving only marks the case approved. Nothing is ever sent from here, and the panel says so.
 */
export function CaseReviewPanel({
  caseId,
  initialStatus,
  initialReply,
  language,
  hasDecision,
  accessCodeRequired = false,
}: {
  caseId: string;
  initialStatus: CaseStatus;
  initialReply: string;
  language: string;
  hasDecision: boolean;
  /** The server asks for an access code before a case can be changed. */
  accessCodeRequired?: boolean;
}) {
  const router = useRouter();
  const replyId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<CaseStatus>(initialStatus);
  const [savedReply, setSavedReply] = useState(initialReply);
  const [draft, setDraft] = useState(initialReply);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [accessCode, setAccessCode] = useAccessCode();
  const [codeRefused, setCodeRefused] = useState(false);

  const busy = pending !== null;
  const dirty = draft.trim() !== savedReply.trim();

  async function send(kind: Exclude<Pending, null>, body: { status?: CaseStatus; customerReply?: string }) {
    setPending(kind);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...accessHeaders(accessCode) },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { case?: CaseRecord; message?: string; error?: string } | null;
      if (res.status === 401 && data?.error === "access_code_required") setCodeRefused(true);
      if (!res.ok || !data?.case) {
        setError(data?.message ?? "The change could not be saved.");
        return false;
      }
      setCodeRefused(false);
      setStatus(data.case.status);
      const reply = data.case.decision?.customerReply ?? savedReply;
      setSavedReply(reply);
      setDraft(reply);
      setEditing(false);
      // Re-render the server-side parts (header status, trace) with the new state.
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Try again.");
      return false;
    } finally {
      setPending(null);
    }
  }

  function startEditing() {
    setEditing(true);
    // Focus after the textarea becomes editable.
    queueMicrotask(() => textarea.current?.focus());
  }

  async function copyReply() {
    try {
      await navigator.clipboard.writeText(savedReply);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy: select the text and copy it by hand.");
    }
  }

  return (
    <section aria-labelledby={`${replyId}-title`} className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id={`${replyId}-title`} className="text-base font-semibold">
          Reply to the customer
        </h2>
        <span className="rounded-full bg-background px-2.5 py-0.5 text-xs font-medium text-muted">
          {languageName(language)}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">Drafted by the agent. It is only sent if you send it yourself.</p>

      <label htmlFor={replyId} className="sr-only">
        Text of the reply
      </label>
      <textarea
        id={replyId}
        ref={textarea}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        readOnly={!editing}
        rows={9}
        className={`mt-3 w-full rounded-md border px-3 py-2 text-sm leading-relaxed ${
          editing ? "border-accent bg-surface" : "border-border bg-background"
        }`}
      />

      {editing && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={PRIMARY}
            disabled={busy || !dirty || draft.trim() === ""}
            onClick={() => void send("save", { customerReply: draft })}
          >
            {pending === "save" ? "Saving…" : "Save edit"}
          </button>
          <button
            type="button"
            className={SECONDARY}
            disabled={busy}
            onClick={() => {
              setDraft(savedReply);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {(accessCodeRequired || codeRefused) && (
        <div className="mt-3">
          <AccessCodeField
            id={`${replyId}-code`}
            value={accessCode}
            onChange={setAccessCode}
            hint="This public demo only lets people with the access code approve, edit or reject a case."
          />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {status === "approved" && (
        <p role="status" className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <strong>Approved: ready to send.</strong> Damage Desk sends nothing by itself. Copy the reply and the
          claim e-mail, or hand them to your helpdesk.
        </p>
      )}
      {status === "rejected" && (
        <p role="status" className="mt-4 rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-800">
          <strong>Rejected.</strong> Nothing was sent.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        {status === "approved" || status === "rejected" ? (
          <button type="button" className={SECONDARY} disabled={busy} onClick={() => void send("reopen", { status: "needs_review" })}>
            {pending === "reopen" ? "Reopening…" : "Reopen for review"}
          </button>
        ) : (
          <button
            type="button"
            className={PRIMARY}
            disabled={busy || !hasDecision}
            onClick={() =>
              void send("approve", editing && dirty ? { status: "approved", customerReply: draft } : { status: "approved" })
            }
          >
            {pending === "approve" ? "Approving…" : "Approve"}
          </button>
        )}
        <button type="button" className={SECONDARY} disabled={busy || editing || !hasDecision} onClick={startEditing}>
          Edit
        </button>
        <button
          type="button"
          className={DANGER}
          disabled={busy || status === "rejected"}
          onClick={() => void send("reject", { status: "rejected" })}
        >
          {pending === "reject" ? "Rejecting…" : "Reject"}
        </button>
        <button type="button" className={`${SECONDARY} ml-auto`} disabled={savedReply === ""} onClick={() => void copyReply()}>
          {copied ? "Copied" : "Copy reply"}
        </button>
      </div>
      {!hasDecision && (
        <p className="mt-3 text-xs text-muted">
          The agent did not produce a decision for this case, so there is nothing to approve. You can still reject it.
        </p>
      )}
    </section>
  );
}
