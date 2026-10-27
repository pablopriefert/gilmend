import { Logo } from "../brand/logo";

/**
 * The footer carries the honest note (nothing is ever sent by Gilmend) and, when the Muse Model
 * License applies, the "Built with Muse Spark Open" line it asks every product to show.
 * `builtWithSparkOpen` is decided in layout.tsx from the server configuration.
 */
export function SiteFooter({ builtWithSparkOpen }: { builtWithSparkOpen: boolean }) {
  return (
    <footer className="mt-12 bg-surface">
      <div aria-hidden="true" className="h-px bg-gradient-to-r from-border via-gold/50 to-border" />
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-[auto_minmax(0,38rem)] md:justify-between md:gap-16">
        <div>
          <Logo />
          <p className="mt-3 font-display text-xl italic text-ink-soft">Broken parcels, mended in gold.</p>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          Fictitious orders and customers only. Gilmend never sends anything to a carrier or a
          customer: every message waits for a human click, and even then it is only marked ready to send.
          {builtWithSparkOpen && " Built with Muse Spark Open."}
        </p>
      </div>
    </footer>
  );
}
