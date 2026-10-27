import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, ServerOff } from "lucide-react";
import { BackLink, BUTTON_PRIMARY, IconTile } from "@/components/case/ui";
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
    console.error("[gilmend] loading a case failed:", err instanceof Error ? err.message : err);
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <h1 className="sr-only">This case could not be loaded</h1>
        <div
          role="alert"
          className="animate-rise flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger-soft p-5 text-sm leading-relaxed text-ink-soft shadow-card"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" strokeWidth={1.75} />
          <p className="min-w-0 text-danger">{message}</p>
        </div>
      </div>
    );
  }
  if (!found) {
    // A report filed on a deployment with temporary, per-instance storage (Vercel, no shared
    // store) can be missing when another instance answers: say so instead of a bare 404.
    if (id.startsWith("case_") && storageIsEphemeral()) {
      return (
        <div className="animate-rise mx-auto flex max-w-lg flex-col items-center py-16 text-center">
          <IconTile icon={ServerOff} className="h-12 w-12 rounded-2xl [&_svg]:h-6 [&_svg]:w-6" />
          <h1 className="mt-6 font-display text-4xl leading-[1.05] tracking-tight text-ink sm:text-5xl">This case is not on this server</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            This deployment keeps new reports in temporary storage that belongs to one server instance, so a
            report you filed can be missing when another instance answers. File it again, or open one of the
            recorded runs in the list.
          </p>
          <Link href="/" className={`${BUTTON_PRIMARY} mt-8`}>
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
