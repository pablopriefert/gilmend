"use client";

import { Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { PrimaryLink } from "./primary-link";

/**
 * The header's one primary action. It steps aside on the report screen itself, where the form's
 * own submit button is the primary action (one primary action per screen). On a phone only
 * "Report" is drawn; the rest of the name stays for screen readers so the accessible name is the
 * same everywhere.
 */
export function HeaderCta() {
  const pathname = usePathname() ?? "/";
  if (pathname.startsWith("/report")) return null;
  return (
    <PrimaryLink href="/report" icon={<Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />}>
      <span>
        Report <span className="sr-only sm:not-sr-only">a damaged parcel</span>
      </span>
    </PrimaryLink>
  );
}
