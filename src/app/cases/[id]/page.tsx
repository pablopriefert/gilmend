import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseView } from "@/components/case-view";
import { getCarrierRules } from "@/lib/rules/carriers";
import { storageIsEphemeral } from "@/lib/storage";
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
  if (!found) {
    // A report filed on a deployment with temporary, per-instance storage (Vercel, no shared
    // store) can be missing when another instance answers: say so instead of a bare 404.
    if (id.startsWith("case_") && storageIsEphemeral()) {
      return (
        <div className="mx-auto max-w-lg py-16 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">This case is not on this server</h1>
          <p className="mt-2 text-sm text-muted">
            This deployment keeps new reports in temporary storage that belongs to one server instance, so a
            report you filed can be missing when another instance answers. File it again, or open one of the
            recorded runs in the list.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Back to cases
          </Link>
        </div>
      );
    }
    notFound();
  }

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
