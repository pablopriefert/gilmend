"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Ban,
  Check,
  CircleCheck,
  Languages,
  Lock,
  MessageSquareText,
  Pencil,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import type { CaseRecord, CaseStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AccessCodeField, accessHeaders, useAccessCode } from "./access-code";
import { CopyButton } from "./case/copy-button";
import { CaseToastHost, useCaseToast } from "./case/toast-host";
import { BUTTON_BASE, BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_QUIET, BUTTON_SECONDARY, Panel, Pill, riseStyle } from "./case/ui";
import { languageName } from "./format";

type Pending = "approve" | "reject" | "reopen" | "save" | null;

interface ReviewState {
  caseId: string;
  status: CaseStatus;
  savedReply: string;
  draft: string;
  setDraft: (value: string) => void;
  editing: boolean;
  pending: Pending;
  error: string | null;
  setError: (message: string | null) => void;
  language: string;
  hasDecision: boolean;
  accessCodeRequired: boolean;
  accessCode: string;
  setAccessCode: (value: string) => void;
  codeRefused: boolean;
  setCodeRefused: (refused: boolean) => void;
  /** DOM id of the reply textarea, so Edit (in the sticky column) can focus it. */
  replyId: string;
  dirty: boolean;
  busy: boolean;
  send: (kind: Exclude<Pending, null>, body: { status?: CaseStatus; customerReply?: string }) => Promise<boolean>;
  startEditing: () => void;
  cancelEditing: () => void;
}

const ReviewContext = createContext<ReviewState | null>(null);

function useReview(): ReviewState {
  const ctx = useContext(ReviewContext);
  if (!ctx) throw new Error("ReviewActions and ReplyCard must be inside a CaseReviewProvider");
  return ctx;
}

/**
 * What a sibling of the review (the "Customer replied" form) shares with it: the access code, typed
 * once for the whole page, and whether the server refused it. Must be inside a CaseReviewProvider.
 */
export function useReviewAccess(): Pick<ReviewState, "accessCodeRequired" | "accessCode" | "setAccessCode" | "codeRefused" | "setCodeRefused"> {
  const r = useReview();
  return {
    accessCodeRequired: r.accessCodeRequired,
    accessCode: r.accessCode,
    setAccessCode: r.setAccessCode,
    codeRefused: r.codeRefused,
    setCodeRefused: r.setCodeRefused,
  };
}

const SUCCESS_TOAST: Record<Exclude<Pending, null>, { title: string; description: string }> = {
  approve: { title: "Case approved", description: "Marked ready to send. Nothing has left Gilmend." },
  reject: { title: "Case rejected", description: "The claim and the reply stay unsent." },
  reopen: { title: "Case reopened", description: "Back in review, ready for another look." },
  save: { title: "Reply saved", description: "Your edit replaces the agent's draft." },
};

/**
 * The human's part, shared by the two places it shows: the actions in the sticky right column
 * and the drafted customer reply in the left one. Approving only marks the case approved.
 * Nothing is ever sent from here, and the page says so. The server-side case re-renders after
 * each change (router.refresh); `syncKey` tells this provider when the server has moved on, so
 * the page itself is never remounted (no replayed entrance, no reloaded PDF).
 */
export function CaseReviewProvider({
  caseId,
  initialStatus,
  initialReply,
  syncKey,
  language,
  hasDecision,
  accessCodeRequired = false,
  children,
}: {
  caseId: string;
  initialStatus: CaseStatus;
  initialReply: string;
  /** Changes whenever the server-side case changes (a refresh after an action). */
  syncKey: string;
  language: string;
  hasDecision: boolean;
  /** The server asks for an access code before a case can be changed. */
  accessCodeRequired?: boolean;
  children: ReactNode;
}) {
  return (
    <CaseToastHost>
      <ReviewStateProvider
        caseId={caseId}
        initialStatus={initialStatus}
        initialReply={initialReply}
        syncKey={syncKey}
        language={language}
        hasDecision={hasDecision}
        accessCodeRequired={accessCodeRequired}
      >
        {children}
      </ReviewStateProvider>
    </CaseToastHost>
  );
}

function ReviewStateProvider({
  caseId,
  initialStatus,
  initialReply,
  syncKey,
  language,
  hasDecision,
  accessCodeRequired,
  children,
}: {
  caseId: string;
  initialStatus: CaseStatus;
  initialReply: string;
  syncKey: string;
  language: string;
  hasDecision: boolean;
  accessCodeRequired: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const notify = useCaseToast();
  const replyId = useId();
  const [status, setStatus] = useState<CaseStatus>(initialStatus);
  const [savedReply, setSavedReply] = useState(initialReply);
  const [draft, setDraft] = useState(initialReply);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useAccessCode();
  const [codeRefused, setCodeRefused] = useState(false);
  const [seenKey, setSeenKey] = useState(syncKey);

  // The server re-rendered the case (after router.refresh, or another tab changed it): follow it.
  if (seenKey !== syncKey) {
    setSeenKey(syncKey);
    setStatus(initialStatus);
    setSavedReply(initialReply);
    setDraft(initialReply);
    setEditing(false);
  }

  const busy = pending !== null;
  const dirty = draft.trim() !== savedReply.trim();

  const send = useCallback(
    async (kind: Exclude<Pending, null>, body: { status?: CaseStatus; customerReply?: string }) => {
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
        notify(SUCCESS_TOAST[kind]);
        // Re-render the server-side parts (header status, trace) with the new state.
        router.refresh();
        return true;
      } catch {
        setError("Could not reach the server. Try again.");
        return false;
      } finally {
        setPending(null);
      }
    },
    [accessCode, caseId, notify, router, savedReply],
  );

  const startEditing = useCallback(() => {
    setEditing(true);
    // Focus after the textarea becomes editable.
    queueMicrotask(() => document.getElementById(replyId)?.focus());
  }, [replyId]);

  const cancelEditing = useCallback(() => {
    setDraft(savedReply);
    setEditing(false);
  }, [savedReply]);

  const value = useMemo<ReviewState>(
    () => ({
      caseId,
      status,
      savedReply,
      draft,
      setDraft,
      editing,
      pending,
      error,
      setError,
      language,
      hasDecision,
      accessCodeRequired,
      accessCode,
      setAccessCode,
      codeRefused,
      setCodeRefused,
      replyId,
      dirty,
      busy,
      send,
      startEditing,
      cancelEditing,
    }),
    [
      caseId,
      status,
      savedReply,
      draft,
      editing,
      pending,
      error,
      language,
      hasDecision,
      accessCodeRequired,
      accessCode,
      setAccessCode,
      codeRefused,
      setCodeRefused,
      dirty,
      busy,
      send,
      startEditing,
      cancelEditing,
      replyId,
    ],
  );

  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

/**
 * Approve, Edit or Reject. Approve is the one primary action (ink, with the gold shimmer of the
 * brand); Reject is set apart below a hairline so it is never hit by accident.
 */
export function ReviewActions() {
  const r = useReview();
  const titleId = useId();
  const codeId = useId();
  const closed = r.status === "approved" || r.status === "rejected";
  const approveDisabled = r.busy || !r.hasDecision;
  // The Approve / Reject button gives way to a status message: move focus there so a keyboard or
  // screen-reader user hears the outcome instead of landing on the page top.
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusStatusNext = useRef(false);
  useEffect(() => {
    if (focusStatusNext.current && closed) {
      statusRef.current?.focus();
      focusStatusNext.current = false;
    }
  }, [closed, r.status]);

  return (
    <section
      aria-labelledby={titleId}
      style={riseStyle(1)}
      className="animate-rise rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6"
    >
      <h2 id={titleId} className="text-base font-semibold tracking-tight text-ink">
        Your review
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        The agent proposes, you decide. Nothing leaves Gilmend from this page.
      </p>

      {(r.accessCodeRequired || r.codeRefused) && (
        <div className="mt-4 rounded-xl border border-border bg-surface-muted p-3.5">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-soft">
            <Lock aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Protected demo
          </p>
          <div className="[&_input]:min-h-11 [&_input]:rounded-xl [&_input]:border-border-strong [&_input]:sm:w-full [&_label]:text-xs [&_label]:font-semibold">
            <AccessCodeField
              id={codeId}
              value={r.accessCode}
              onChange={r.setAccessCode}
              hint="This public demo only lets people with the access code approve, edit or reject a case."
            />
          </div>
        </div>
      )}

      {r.error && (
        <p role="alert" className="mt-4 flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger-soft px-3.5 py-3 text-sm text-danger">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <span>{r.error}</span>
        </p>
      )}

      {r.status === "approved" && (
        <p ref={statusRef} tabIndex={-1} role="status" className="mt-4 flex items-start gap-2.5 rounded-xl border border-success/20 outline-offset-2 bg-success-soft px-3.5 py-3 text-sm leading-relaxed text-ink-soft">
          <CircleCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
          <span>
            <strong className="font-semibold text-ink">Approved: ready to send.</strong> Gilmend sends nothing by itself. Copy
            the reply and the claim e-mail, or hand them to your helpdesk.
          </span>
        </p>
      )}
      {r.status === "rejected" && (
        <p ref={statusRef} tabIndex={-1} role="status" className="mt-4 flex items-start gap-2.5 rounded-xl border border-border-strong outline-offset-2 bg-surface-muted px-3.5 py-3 text-sm leading-relaxed text-ink-soft">
          <Ban aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" strokeWidth={2} />
          <span>
            <strong className="font-semibold text-ink">Rejected.</strong> Nothing was sent.
          </span>
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3">
        {closed ? (
          <button
            type="button"
            className={cn(BUTTON_SECONDARY, "w-full")}
            disabled={r.busy}
            onClick={() => void r.send("reopen", { status: "needs_review" })}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
            {r.pending === "reopen" ? "Reopening…" : "Reopen for review"}
          </button>
        ) : (
          // One button for every state, so keyboard focus is never lost when it goes busy or disabled.
          <ShimmerButton
            type="button"
            background="var(--ink)"
            shimmerColor="var(--gold-bright)"
            shimmerDuration="3.4s"
            borderRadius="12px"
            disabled={approveDisabled}
            aria-busy={r.pending === "approve"}
            className={cn(
              BUTTON_BASE,
              "h-12 w-full gap-2 border-0 text-white shadow-raised disabled:opacity-60",
              // The gold glint is decoration: gone when the button is disabled and for reduced motion.
              "disabled:[&>div:first-of-type]:hidden motion-reduce:[&>div:first-of-type]:hidden",
            )}
            onClick={() => {
              focusStatusNext.current = true;
              void r
                .send("approve", r.editing && r.dirty ? { status: "approved", customerReply: r.draft } : { status: "approved" })
                .then((ok) => {
                  if (!ok) focusStatusNext.current = false;
                });
            }}
          >
            <Check aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
            {r.pending === "approve" ? "Approving…" : "Approve"}
          </ShimmerButton>
        )}
        <button
          type="button"
          className={cn(BUTTON_SECONDARY, "w-full")}
          disabled={r.busy || r.editing || !r.hasDecision}
          onClick={r.startEditing}
        >
          <Pencil aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          Edit
        </button>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <button
          type="button"
          className={cn(BUTTON_DANGER, "w-full")}
          disabled={r.busy || r.status === "rejected"}
          onClick={() => {
            focusStatusNext.current = true;
            void r.send("reject", { status: "rejected" }).then((ok) => {
              if (!ok) focusStatusNext.current = false;
            });
          }}
        >
          <X aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
          {r.pending === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>

      {!r.hasDecision && (
        <p className="mt-4 text-xs leading-relaxed text-muted">
          The agent did not produce a decision for this case, so there is nothing to approve. You can still reject it.
        </p>
      )}
    </section>
  );
}

/** The agent's drafted reply, readable, editable in place and copyable. */
export function ReplyCard({ index = 0 }: { index?: number }) {
  const r = useReview();
  const replyId = r.replyId;

  return (
    <Panel
      id={`${replyId}-title`}
      title="Reply to the customer"
      icon={MessageSquareText}
      index={index}
      action={
        <div className="flex items-center gap-2">
          <Pill icon={Languages}>{languageName(r.language)}</Pill>
          <CopyButton
            text={r.savedReply}
            label="Copy reply"
            toastTitle="Reply copied"
            disabled={r.savedReply === ""}
            onError={() => r.setError("Could not copy: select the text and copy it by hand.")}
          />
        </div>
      }
    >
      <p className="text-sm text-muted">Drafted by the agent. It is only sent if you send it yourself.</p>

      <label htmlFor={replyId} className="sr-only">
        Text of the reply
      </label>
      <textarea
        id={replyId}
        value={r.draft}
        onChange={(e) => r.setDraft(e.target.value)}
        readOnly={!r.editing}
        rows={9}
        className={cn(
          "mt-3 w-full resize-y rounded-xl border px-4 py-3 text-[0.9375rem] leading-relaxed text-ink transition-[border-color,box-shadow,background-color] duration-200",
          r.editing
            ? "border-accent bg-surface shadow-[0_0_0_3px_var(--accent-soft)]"
            : "border-border bg-surface-muted",
        )}
      />

      {r.editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(BUTTON_PRIMARY, "pointer-fine:min-h-10")}
            disabled={r.busy || !r.dirty || r.draft.trim() === ""}
            onClick={() => void r.send("save", { customerReply: r.draft })}
          >
            {r.pending === "save" ? "Saving…" : "Save edit"}
          </button>
          <button type="button" className={cn(BUTTON_QUIET, "pointer-fine:min-h-10")} disabled={r.busy} onClick={r.cancelEditing}>
            Cancel
          </button>
          <p className="text-xs text-muted">You are editing the draft. Approve also saves it.</p>
        </div>
      )}
    </Panel>
  );
}
