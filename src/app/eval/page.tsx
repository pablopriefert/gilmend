import { EvalEmpty, EvalReport } from "@/components/eval/eval-report";
import { loadLatestEval, type LoadedEval } from "@/lib/eval/results";

// Reads the committed evaluation (data/eval) at run time; next.config.ts traces the folder into
// this route. Without a committed file the page says so, it never shows a stand-in.
export const dynamic = "force-dynamic";

export const metadata = { title: "Evaluation" };

export default function EvalPage() {
  let latest: LoadedEval | null = null;
  let error: string | null = null;
  try {
    latest = loadLatestEval();
  } catch (err) {
    // A broken results file must not look like "no evaluation yet". The server log keeps the detail.
    console.error("[gilmend] reading the evaluation failed:", err instanceof Error ? err.message : err);
    error = "The evaluation results could not be read. Check the server log, then reload the page.";
  }
  if (error) {
    return (
      <p role="alert" className="max-w-2xl rounded-2xl border border-danger/20 bg-danger-soft p-5 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!latest) return <EvalEmpty />;
  return <EvalReport results={latest.results} file={latest.file} />;
}
