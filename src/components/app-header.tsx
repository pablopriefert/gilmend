import Link from "next/link";
import { resolveEngine } from "@/lib/config";
import { Logo } from "./brand/logo";
import { EngineBadge } from "./engine-badge";
import { NavLinks } from "./nav-links";
import { HeaderCta } from "./shell/header-cta";

/**
 * Site header, sticky from tablet width up (on a phone it scrolls away: three stacked rows would
 * eat a third of the screen). It always shows which engine a new report would run on, so a server
 * without a key can never be mistaken for one talking to Muse (the chip says DEMO MODE, in full).
 * Order of the flex children: below `xl` = logo + action, nav, engine; from `xl` = logo, nav, engine, action on one row.
 * The single row needs about 1060px with the three nav links (27 Oct 2026: with "Impact" added it no longer
 * fitted at 1024px, where "New report" and the action wrapped onto two lines), hence `xl` and not `lg`.
 */
export function AppHeader() {
  const engine = resolveEngine("muse-spark-1.3");
  return (
    <header className="z-40 bg-surface/85 backdrop-blur-md md:sticky md:top-0">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-6 xl:flex-nowrap xl:gap-x-6">
        <Link
          href="/"
          aria-label="Gilmend, all cases"
          className="order-1 mr-auto -ml-1.5 rounded-xl p-1.5 transition-opacity duration-150 hover:opacity-80 xl:mr-0"
        >
          <Logo />
        </Link>
        <div className="order-3 w-full xl:order-2 xl:w-auto">
          <NavLinks />
        </div>
        <div className="order-4 flex w-full min-w-0 items-center gap-2 xl:order-3 xl:ml-auto xl:w-auto">
          <span className="sr-only">Engine used for new reports:</span>
          <EngineBadge engine={engine} />
        </div>
        <div className="order-2 xl:order-4">
          <HeaderCta />
        </div>
      </div>
      {/* A hairline with a thread of gold in it: the seam, once, under the header. */}
      <div aria-hidden="true" className="h-px bg-gradient-to-r from-border via-gold/50 to-border" />
    </header>
  );
}
