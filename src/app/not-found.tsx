import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { BUTTON_PRIMARY } from "@/components/case/ui";

export default function NotFound() {
  return (
    <div className="relative mx-auto max-w-lg px-2 py-16 text-center sm:py-24">
      <div className="animate-rise relative mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-surface shadow-raised ring-1 ring-border">
        <LogoMark className="h-12 w-12" />
      </div>
      <p className="animate-rise relative mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-muted" style={{ animationDelay: "50ms" }}>
        Error 404
      </p>
      <h1 className="animate-rise relative mt-3 font-display text-4xl leading-[1.05] tracking-tight text-ink sm:text-5xl" style={{ animationDelay: "80ms" }}>
        Case not found
      </h1>
      <p className="animate-rise relative mx-auto mt-4 max-w-sm text-[15px] leading-relaxed text-muted" style={{ animationDelay: "110ms" }}>
        This page or case does not exist (or was removed).
      </p>
      <div className="animate-rise relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row" style={{ animationDelay: "140ms" }}>
        {/* Ink, not the gold-shimmer PrimaryLink: gold is for money, and this page has none. */}
        <Link href="/" className={BUTTON_PRIMARY}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
          Back to cases
        </Link>
        <Link
          href="/report"
          className="inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-semibold text-accent underline-offset-4 hover:underline"
        >
          Report a damaged parcel
        </Link>
      </div>
    </div>
  );
}
