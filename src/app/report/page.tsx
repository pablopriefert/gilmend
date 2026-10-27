import { ReportForm } from "@/components/report-form";
import { describeEngine, hasModelKey, hasOpenRouterKey, hasOpenWeightsConfig } from "@/lib/config";
import { accessCodeRequired } from "../api/_lib/access";

// Reads the server environment to say honestly which engines are configured.
export const dynamic = "force-dynamic";

export const metadata = { title: "New report" };

export default function ReportPage() {
  const openWeights = hasOpenWeightsConfig();
  const openRouter = hasOpenRouterKey();
  return (
    <ReportForm
      availability={{
        museKey: hasModelKey(),
        openWeights,
        openWeightsDetail: openWeights ? describeEngine("open-weights") : undefined,
        openRouter,
        openRouterDetail: openRouter ? describeEngine("openrouter") : undefined,
        accessCodeRequired: accessCodeRequired(),
      }}
    />
  );
}
