import { useId } from "react";
import { cn } from "@/lib/utils";

// Gilmend = gild + mend. The mark is a parcel seen from above (the ink tile and its tape line)
// crossed by a kintsugi seam: the crack is not hidden, it is filled with gold. That is the
// product in one picture: a broken parcel turned back into money.

export function LogoMark({ className, title }: { className?: string; title?: string }) {
  // One gradient id per instance: the header, the 404 page and the case page can all show the mark,
  // and duplicate ids make the later ones point at the first (or at nothing once it is hidden).
  const gold = `gilmend-gold-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("h-8 w-8 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--ink, #15161c)" />
      {/* The parcel's tape line, faint: the box is still a box. */}
      <path d="M16 4.5v23" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="2" />
      {/* The gold seam, with one short branch like a real kintsugi repair. */}
      <path
        d="M6 9.5 12.2 14.6 10.6 18.4 17.4 21 21 17.2 26 22.5"
        fill="none"
        stroke={`url(#${gold})`}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17.4 21 18.6 25.6" fill="none" stroke={`url(#${gold})`} strokeWidth="1.6" strokeLinecap="round" />
      <defs>
        <linearGradient id={gold} x1="6" y1="9" x2="26" y2="23" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f3d27a" />
          <stop offset="0.55" stopColor="#d4a537" />
          <stop offset="1" stopColor="#a87a1a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Mark + wordmark. The wordmark is set in the display serif (see layout.tsx fonts). */
export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markClassName} />
      <span className="font-display text-[1.45rem] leading-none tracking-tight text-ink">Gilmend</span>
    </span>
  );
}
