import Link from "next/link";
import { resolveEngine } from "@/lib/config";
import { EngineBadge } from "./engine-badge";
import { NavLinks } from "./nav-links";

/**
 * Site header. It always shows which engine a new report would run on, so a server
 * without a key can never be mistaken for one talking to Muse (the badge says DEMO MODE).
 */
export function AppHeader() {
  const engine = resolveEngine("muse-spark-1.3");
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-bold text-white"
          >
            D
          </span>
          Damage Desk
        </Link>
        <NavLinks />
        <div className="ml-auto flex items-center gap-2">
          <span className="sr-only">Engine used for new reports:</span>
          <EngineBadge engine={engine} />
        </div>
      </div>
    </header>
  );
}
