"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Cases" },
  { href: "/report", label: "New report" },
] as const;

/** Top navigation. A client component only to mark the current page (`aria-current`). */
export function NavLinks() {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      {LINKS.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" || pathname.startsWith("/cases") : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-md bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent"
                : "rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-black/5 hover:text-foreground"
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
