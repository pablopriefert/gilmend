import { ReportForm } from "@/components/report-form";
import { hasModelKey, hasOpenWeightsConfig } from "@/lib/config";
import { accessCodeRequired } from "../api/_lib/access";

// Reads the server environment to say honestly which engines are configured.
export const dynamic = "force-dynamic";

export const metadata = { title: "New report" };

export default function ReportPage() {
  return (
    <ReportForm
      availability={{
        museKey: hasModelKey(),
        openWeights: hasOpenWeightsConfig(),
        accessCodeRequired: accessCodeRequired(),
      }}
    />
  );
}
