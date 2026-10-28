import { CasesDashboard } from "@/components/cases-dashboard";
import { storageIsEphemeral } from "@/lib/storage";
import { listCases } from "@/lib/store/cases";
import { loadLatestSweep } from "@/lib/sweep/store";
import type { SweepResult } from "@/lib/sweep/types";
import type { CaseRecord } from "@/lib/types";
import { accessCodeRequired } from "./api/_lib/access";

// The list changes whenever a report comes in: never prerender it.
export const dynamic = "force-dynamic";

export const metadata = { title: "Cases" };

export default async function CasesPage() {
  let cases: CaseRecord[] = [];
  let error: string | null = null;
  try {
    cases = await listCases();
  } catch (err) {
    // An unreadable store must not look like "no cases". The server log keeps the detail.
    console.error("[gilmend] listing cases failed:", err instanceof Error ? err.message : err);
    error = "Cases could not be loaded. Check the server log, then reload the page.";
  }
  // The latest morning sweep. An unreadable one is "no sweep yet" on this page: the cases above
  // are what matters, and the server log keeps the detail.
  let sweep: SweepResult | null = null;
  try {
    sweep = await loadLatestSweep();
  } catch (err) {
    console.error("[gilmend] reading the sweep failed:", err instanceof Error ? err.message : err);
  }
  return (
    <CasesDashboard
      cases={cases}
      error={error}
      now={new Date()}
      today={{ sweep, accessCodeRequired: accessCodeRequired(), storageEphemeral: storageIsEphemeral() }}
    />
  );
}
