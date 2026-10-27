import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseView } from "@/components/case-view";
import { getCarrierRules } from "@/lib/rules/carriers";
import { getCase } from "@/lib/store/cases";
import type { CarrierRules, CaseRecord } from "@/lib/types";
import { accessCodeRequired } from "../../api/_lib/access";
import { isValidCaseId } from "../../api/_lib/responses";

export const dynamic = "force-dynamic";

export const metadata = { title: "Case" };

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidCaseId(id)) notFound();

  let found: CaseRecord | null;
  try {
    found = await getCase(id);
  } catch (err) {
    // An unreadable store is not "case not found": say what happened.
    const message = "This case could not be loaded. Check the server log, then reload the page.";
    console.error("[damage-desk] loading a case failed:", err instanceof Error ? err.message : err);
    return (
      <div className="flex flex-col gap-4">
        <Link href="/" className="text-sm font-medium text-accent underline-offset-2 hover:underline">
          ← All cases
        </Link>
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm text-danger">
          {message}
        </div>
      </div>
    );
  }
  if (!found) notFound();

  // The rules give the case page its sources and "unverified" flags. A rules module that is
  // missing or throws must not take the whole case down: the claim card then says so.
  let rules: CarrierRules | null = null;
  if (found.order) {
    try {
      rules = getCarrierRules(found.order.carrier);
    } catch {
      rules = null;
    }
  }

  return <CaseView caseRecord={found} rules={rules} now={new Date()} accessCodeRequired={accessCodeRequired()} />;
}
