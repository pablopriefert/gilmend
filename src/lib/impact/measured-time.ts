import type { CaseRecord } from "../types";

// How long the agent really took, read from the recorded runs (data/showcase/, six real runs of
// Muse Spark 1.3 made on 27 Oct 2026, five of them with a SAM 3.1 outline). The ROI page uses this for the "with Gilmend"
// time per case, so that number is a measurement, not a promise: it is the span between the
// first and the last step of each run's trace.
//
// What it is not: a benchmark. Six runs, on six scripted scenarios, with generated photos. The
// page says so next to the figure.

/** A run longer than this is a hung call or a clock error, not a measurement. */
const MAX_PLAUSIBLE_SECONDS = 600;

export interface MeasuredRun {
  id: string;
  /** Order number, to name the run on the page. */
  orderId: string;
  seconds: number;
  /** What the agent decided in that run (nothing to claim runs are shorter). */
  decision: string | null;
  /**
   * Whether a SAM 3.1 outline was drawn in this run. A run that stops at "ask for better photos"
   * never calls SAM, so its time does not include one (27 Oct 2026 review: the page said all six
   * runs included the outline).
   */
  withSam: boolean;
}

export interface MeasuredTime {
  runs: MeasuredRun[];
  meanSeconds: number;
  medianSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  /** Most recent recording day (YYYY-MM-DD). */
  recordedOn: string;
}

function traceSeconds(c: CaseRecord): number | null {
  if (c.trace.length < 2) return null;
  const first = Date.parse(c.trace[0].at);
  const last = Date.parse(c.trace[c.trace.length - 1].at);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  const seconds = (last - first) / 1000;
  return seconds > 0 && seconds <= MAX_PLAUSIBLE_SECONDS ? seconds : null;
}

/**
 * The duration of every recorded run that really ran on a model, and its mean, median and range.
 * Returns null when there is nothing to measure (a fresh clone without the showcase, or a test):
 * the page then says the time is not measured instead of inventing one. A DEMO MODE run is
 * ignored even when it is marked recorded: its speed is a script's, not a model's.
 */
export function measureAgentTime(cases: CaseRecord[]): MeasuredTime | null {
  const runs: MeasuredRun[] = [];
  const days: string[] = [];
  for (const c of cases) {
    if (!c.recorded || c.engine === "demo-mock") continue;
    const seconds = traceSeconds(c);
    if (seconds === null) continue;
    runs.push({
      id: c.id,
      orderId: c.order?.id ?? c.report.orderNumber,
      seconds,
      decision: c.decision?.decision ?? null,
      withSam: c.evidence.some((e) => e.method === "sam-3.1"),
    });
    days.push(c.recorded.recordedOn);
  }
  if (runs.length === 0) return null;
  const sorted = runs.map((r) => r.seconds).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    runs: runs.sort((a, b) => a.id.localeCompare(b.id)),
    meanSeconds: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    medianSeconds: median,
    minSeconds: sorted[0],
    maxSeconds: sorted[sorted.length - 1],
    recordedOn: days.sort()[days.length - 1],
  };
}
