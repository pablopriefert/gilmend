// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeResults } from "@/lib/eval/test-helpers";
import { EvalEmpty, EvalReport } from "./eval-report";

describe("EvalReport", () => {
  const renderReport = (over = {}) => render(<EvalReport results={makeResults(over)} file="2026-10-27-muse-spark-1.3.json" />);

  it("frames the evaluation as a sanity check before any figure", () => {
    renderReport();
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("2 cases × 3 runs: a sanity check on the demo, not a benchmark.");
    expect(note).toHaveTextContent(/built and tuned on/);
    expect(note).toHaveTextContent(/AI-generated stand-ins/);
    // The framing comes before the summary in the page.
    const position = note.compareDocumentPosition(screen.getByRole("heading", { name: "Summary", hidden: true }));
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the headline figures from the results", () => {
    renderReport();
    // 3 vase runs + 2 of 3 carton runs meet every expectation.
    expect(screen.getByText("5/6")).toBeInTheDocument();
    expect(screen.getByText(/runs \(83%\)/)).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument(); // cases that gave the same answer every run
    expect(screen.getByText("$0.42")).toBeInTheDocument();
    expect(screen.getByText(/decision 6, carrier claim 5, human review 6, claim eligibility 5/)).toBeInTheDocument();
  });

  it("shows expected against observed for each case, with the carrier claim kept k of n", () => {
    renderReport();
    const vase = screen.getByRole("heading", { name: /Broken vase/ }).closest("li") as HTMLElement;
    expect(within(vase).getByText("3 of 3 runs meet every expectation")).toBeInTheDocument();
    expect(within(vase).getByText("Reship or Refund")).toBeInTheDocument();
    expect(within(vase).getByText("Reship ×3")).toBeInTheDocument();
    expect(within(vase).getByText("3 of 3 runs", { selector: ".tabular" , exact: true })).toBeInTheDocument();
    expect(within(vase).getByText("€32.20")).toBeInTheDocument();
    expect(within(vase).getByText("Same answer every run")).toBeInTheDocument();
  });

  it("reports a disagreement plainly, with the run, the missed field and the agent's own reasons", () => {
    renderReport();
    const carton = screen.getByRole("heading", { name: /Crushed carton/ }).closest("li") as HTMLElement;
    expect(within(carton).getByText("2 of 3 runs meet every expectation")).toBeInTheDocument();
    expect(within(carton).getByText("The runs differ")).toBeInTheDocument();
    expect(within(carton).getByText(/Run 2: No action, claim\. Missed carrier claim, claim eligibility/)).toBeInTheDocument();
    expect(within(carton).getByText("The carton is crushed, so the carrier is at fault.")).toBeInTheDocument();
    expect(within(carton).getByText(/Guardrail: the order total is under/)).toBeInTheDocument();
    // Claim amounts only from the run that computed one.
    expect(within(carton).getByText("€23")).toBeInTheDocument();
  });

  it("gives the exact command and what the evaluation ran on", () => {
    renderReport();
    expect(screen.getByText("npm run eval -- --runs 3")).toBeInTheDocument();
    expect(screen.getByText("Muse Spark 1.3 (Meta Model API)", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("data/eval/2026-10-27-muse-spark-1.3.json")).toBeInTheDocument();
    expect(screen.getByText(/refuses the demo mock/)).toBeInTheDocument();
  });

  it("claims no cost when the provider returned no token usage", () => {
    const results = makeResults({ pricing: null, estimatedCostUsd: null });
    for (const c of results.cases) for (const r of c.runs) r.usage = null;
    render(<EvalReport results={results} file="x.json" />);
    expect(screen.getByText("unknown")).toBeInTheDocument();
    expect(screen.getByText(/no cost is claimed/)).toBeInTheDocument();
    expect(screen.getByText(/6 of 6 runs came back without token usage/)).toBeInTheDocument();
  });

  it("says variance cannot be measured with one run per case", () => {
    const results = makeResults({ runsPerCase: 1 });
    for (const c of results.cases) c.runs = c.runs.slice(0, 1);
    render(<EvalReport results={results} file="x.json" />);
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.getByText(/variance cannot be measured/)).toBeInTheDocument();
  });

  it("notes uncommitted changes when the code was not clean", () => {
    renderReport({ dirty: true });
    expect(screen.getByText("with uncommitted changes")).toBeInTheDocument();
  });
});

describe("EvalEmpty", () => {
  it("shows no figure, only how to produce one", () => {
    render(<EvalEmpty />);
    expect(screen.getByText(/No evaluation has been committed yet/)).toBeInTheDocument();
    expect(screen.getByText("npm run eval -- --runs 3")).toBeInTheDocument();
  });
});
