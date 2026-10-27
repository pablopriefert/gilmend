import { CasesDashboard } from "@/components/cases-dashboard";
import { listCases } from "@/lib/store/cases";
import type { CaseRecord } from "@/lib/types";

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
  return <CasesDashboard cases={cases} error={error} now={new Date()} />;
}
