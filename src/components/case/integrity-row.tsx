import Link from "next/link";
import { CalendarClock, CircleCheck, Fingerprint, TriangleAlert } from "lucide-react";
import type { IntegrityMatch, PhotoIntegrity, PhotoIntegrityPhoto } from "@/lib/types";
import { Eyebrow, Pill } from "./ui";

// The "Integrity" row of the evidence section: what the code checked on the customer's photos
// (same picture filed for another order, capture date against delivery), what it compared, and what
// it found. Honest by construction: it says how much was compared, what a clean result does not
// prove, and that a signal asks a person to look and is never a verdict.

/** Where the row stands when there is no integrity result to show. */
export type IntegrityMissing = "recorded" | "unfinished" | "absent";

/** An instant as "12 Oct 2026, 14:03" in UTC, so the server and the browser print the same text. */
function formatUtc(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(t);
}

function describeMatch(m: IntegrityMatch) {
  if (m.source === "demo") {
    return m.sameOrderAndCustomer
      ? "Its own demo photo (reuse by design)"
      : `The demo photo of demo case ${m.caseId}, filed for another order or customer`;
  }
  return m.sameOrderAndCustomer ? "Same order and customer: a report filed again" : "A different order or customer";
}

function PhotoReuse({ photo }: { photo: PhotoIntegrityPhoto }) {
  const n = photo.index + 1;
  if (!photo.hash) {
    return (
      <li>
        Photo {n}: not hashed, so not compared{photo.unreadable ? ` (${photo.unreadable})` : ""}.
      </li>
    );
  }
  if (photo.matches.length === 0) return <li>Photo {n}: no match.</li>;
  return (
    <li>
      Photo {n}: looks like
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {photo.matches.map((m, i) => (
          <li key={`${m.caseId}-${i}`}>
            {m.source === "case" ? (
              <Link href={`/cases/${encodeURIComponent(m.caseId)}`} className="font-medium text-accent underline underline-offset-2">
                another case
              </Link>
            ) : (
              "a demo photo"
            )}
            : {describeMatch(m)}{" "}
            <span className="tabular text-muted">
              (hash distance {m.dhashDistance}/64 and {m.ahashDistance}/64)
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function IntegrityRow({
  integrity,
  missing = "absent",
}: {
  integrity?: PhotoIntegrity | null;
  missing?: IntegrityMissing;
}) {
  if (!integrity) {
    const why =
      missing === "recorded"
        ? "This recorded run was made before the integrity check existed: its photos carry no hash and cannot be compared."
        : missing === "unfinished"
          ? "The check runs while the agent works; this case has not reached it."
          : "No integrity check was recorded on this case (it was filed before the check existed, or the agent stopped before it).";
    return (
      <div data-testid="integrity" className="mt-6 border-t border-border pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Eyebrow>Integrity</Eyebrow>
          <Pill tone="neutral" icon={Fingerprint}>Not checked</Pill>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">{why}</p>
      </div>
    );
  }

  const flagged = integrity.signals.length > 0;
  const compared =
    integrity.comparedPhotos + integrity.comparedDemoPhotos === 0
      ? "Compared with nothing: no earlier case with a hash, and no demo photo."
      : `Compared with ${integrity.comparedPhotos} ${integrity.comparedPhotos === 1 ? "photo" : "photos"} from ${integrity.comparedCases} earlier ${integrity.comparedCases === 1 ? "case" : "cases"} and ${integrity.comparedDemoPhotos} demo ${integrity.comparedDemoPhotos === 1 ? "photo" : "photos"}.`;

  return (
    <div data-testid="integrity" className="mt-6 border-t border-border pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Integrity</Eyebrow>
        {flagged ? (
          <Pill tone="warn" icon={TriangleAlert}>
            {integrity.signals.length === 1 ? "1 signal: a person must look" : `${integrity.signals.length} signals: a person must look`}
          </Pill>
        ) : (
          <Pill tone="ok" icon={CircleCheck}>No signal</Pill>
        )}
        <span className="text-xs text-muted">
          {integrity.calledBy === "code" ? "Run by the code (the model had not called it)" : "Called by the agent"}
        </span>
      </div>

      {flagged && (
        <ul className="mt-3 space-y-2" aria-label="Integrity signals">
          {integrity.signals.map((s, i) => (
            <li key={`${s.kind}-${s.photoIndex}-${i}`} className="flex gap-2.5 text-sm leading-relaxed text-ink">
              <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={2} />
              <span className="min-w-0">{s.message}</span>
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm leading-relaxed text-ink-soft sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            <Fingerprint aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Same photo elsewhere
          </dt>
          <dd className="mt-1">
            <p>{compared}</p>
            <ul className="mt-1 space-y-1">
              {integrity.photos.map((p) => (
                <PhotoReuse key={p.index} photo={p} />
              ))}
            </ul>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Capture date and delivery
          </dt>
          <dd className="mt-1">
            <p>
              Delivery:{" "}
              {integrity.deliveredAt ? (
                <span className="tabular">
                  {formatUtc(integrity.deliveredAt)} UTC
                </span>
              ) : (
                "unknown (no order, or not delivered yet)"
              )}
              .
            </p>
            <ul className="mt-1 space-y-1">
              {integrity.photos.map((p) => (
                <li key={p.index}>
                  Photo {p.index + 1}:{" "}
                  {p.capturedAt ? (
                    <>
                      taken <span className="tabular">{formatUtc(`${p.capturedAt}Z`)}</span> (as written in the file, no time zone).
                    </>
                  ) : p.hash ? (
                    "no capture date in the file. Most apps strip it, so this is not a signal."
                  ) : (
                    "not read."
                  )}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      {integrity.notes.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-xs leading-relaxed text-muted">
          {integrity.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">
        The comparison uses perceptual hashes: it catches the same file after a resize or a re-save, not a crop, a
        mirror image, an edit or a photo of a screen. A clean result does not prove the photos are genuine, and a
        signal is a reason to look, not a verdict on the customer. Cases filed before this check existed hold no
        hash and cannot be compared.
      </p>
    </div>
  );
}
