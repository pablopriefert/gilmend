import { Plus } from "lucide-react";
import { LogoMark } from "../brand/logo";
import { PrimaryLink } from "../shell/primary-link";

/** No case yet: the mark, one sentence, and the one action that fills the screen. */
export function EmptyState() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-16 text-center sm:py-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-64 w-[34rem] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-bright/25 blur-3xl"
      />
      <div className="animate-rise relative mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-gold-soft ring-1 ring-gold/30 shadow-card">
        <LogoMark className="h-12 w-12" />
      </div>
      <h2 className="animate-rise relative mt-7 font-display text-3xl text-ink sm:text-4xl" style={{ animationDelay: "60ms" }}>
        No cases yet
      </h2>
      <p
        className="animate-rise relative mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted"
        style={{ animationDelay: "100ms" }}
      >
        A case appears here when a customer reports a damaged parcel. Simulate one, or load a demo case
        in a single click.
      </p>
      <div className="animate-rise relative mt-8 flex justify-center" style={{ animationDelay: "140ms" }}>
        <PrimaryLink href="/report" size="lg" icon={<Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />}>
          Report a damaged parcel
        </PrimaryLink>
      </div>
    </section>
  );
}
