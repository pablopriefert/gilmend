// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeResults, makeRun } from "@/lib/eval/test-helpers";
import { EvalEmpty, EvalReport } from "./eval-report";

describe("EvalReport", () => {
  const renderReport = (over = {}) => render(<EvalReport results={makeResults(over)} file="2026-10-27-muse-spark-1.3.json" />);

  it("frames the evaluation as a sanity check before any figure", () => {
    renderReport();
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("2 cases × 3 runs: a sanity check on the demo, not a benchmark.");
    expect(note).toHaveTextContent(/built and tuned on/);
    // 3 of 3 is not presented as a low failure rate: it rules out very little.
    expect(note).toHaveTextContent(/3 of 3 rules out very little/);
    expect(note).not.toHaveTextContent(/one run in ten/);
    expect(note).toHaveTextContent(/the two cases the agent was built and tuned on/);
    expect(note).toHaveTextContent(/AI-generated stand-ins/);
    // The framing comes before the summary in the page.
    const position = note.compareDocumentPosition(screen.getByRole("heading", { name: "Summary", hidden: true }));
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the headline figures from the results", () => {
    renderReport();
    // 3 vase runs + 2 of 3 carton runs meet every expectation.
    expect(screen.getByText("5/6")).toBeInTheDocument();
    // No percentage next to a count the framing says is too small to put a rate on.
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
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

  it("counts the cases of the file in the header, not a fixed number", () => {
    renderReport();
    expect(screen.getByText(/The two demo cases, each run 3 times/)).toBeInTheDocument();
  });

  it("words the cost as an estimate at Meta's starting price, not as an upper bound", () => {
    renderReport();
    const caption = screen.getByText(/for all 6 runs, an estimate at/);
    expect(caption).toHaveTextContent("Meta's published starting price ($1.25/$4.25 per M tokens in/out), cache discounts ignored");
    expect(caption).toHaveTextContent("72k tokens");
    expect(screen.queryByText(/upper bound/)).not.toBeInTheDocument();
  });

  it("says when the prices were set by hand", () => {
    const results = makeResults();
    results.pricing = { ...results.pricing!, source: "set by hand with --price-in and --price-out" };
    render(<EvalReport results={results} file="x.json" />);
    expect(screen.getByText(/an estimate at the prices set by hand \(\$1\.25\/\$4\.25/)).toBeInTheDocument();
  });

  it("says when SAM was called by the code, not by the model, and in how many runs", () => {
    renderReport();
    const carton = screen.getByRole("heading", { name: /Crushed carton/ }).closest("li") as HTMLElement;
    expect(within(carton).getByText("called by code, not the model, in 1 of 3 runs")).toBeInTheDocument();
    // The vase fixture never used the fallback: nothing is said there.
    const vase = screen.getByRole("heading", { name: /Broken vase/ }).closest("li") as HTMLElement;
    expect(within(vase).queryByText(/called by code/)).not.toBeInTheDocument();
  });

  it("counts a run that did not finish apart from the decisions, and words its pill plainly", () => {
    const results = makeResults();
    const carton = results.cases[1];
    carton.runs[2] = makeRun({
      run: 3,
      completed: false,
      failure: "Agent did not reach a decision in time",
      decision: null,
      carrierClaim: null,
      needsHuman: null,
      claimEligible: null,
      claimAmountEur: null,
      matches: { decision: false, carrierClaim: false, needsHuman: false, claimEligible: false, all: false },
    });
    render(<EvalReport results={results} file="x.json" />);
    const card = screen.getByRole("heading", { name: /Crushed carton/ }).closest("li") as HTMLElement;
    expect(within(card).getByText("No action ×2, Not finished ×1")).toBeInTheDocument();
    expect(within(card).getByText("Run 3: not finished (Agent did not reach a decision in time)")).toBeInTheDocument();
    expect(within(card).queryByText(/Missed the run did not finish/)).not.toBeInTheDocument();
  });

  it("gives the exact command and what the evaluation ran on", () => {
    renderReport();
    expect(screen.getByText("npm run eval -- --runs 3")).toBeInTheDocument();
    expect(screen.getByText("Muse Spark 1.3 (Meta Model API)", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("data/eval/2026-10-27-muse-spark-1.3.json")).toBeInTheDocument();
    expect(screen.getByText(/refuses the demo mock/)).toBeInTheDocument();
  });

  it("shows the reasoning effort and API host the run recorded, and says when a file did not", () => {
    const { unmount } = render(
      <EvalReport results={makeResults({ settings: { reasoningEffort: "medium", apiHost: "api.meta.ai" } })} file="x.json" />,
    );
    expect(screen.getByText("medium", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("api.meta.ai", { selector: "dd" })).toBeInTheDocument();
    unmount();
    renderReport();
    expect(screen.getAllByText("not recorded in this file", { selector: "dd" })).toHaveLength(2);
  });

  it("says how many tokens the provider served from its cache, since the estimate ignores the discount", () => {
    const results = makeResults();
    results.cases[0].runs[0].usage!.cachedTokens = 4000;
    render(<EvalReport results={results} file="x.json" />);
    expect(screen.getByText(/4k served from the provider's cache/)).toBeInTheDocument();
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

describe("EvalReport against the deployed commit", () => {
  const renderWith = (deployedCommit: string | null | undefined, over = {}) =>
    render(<EvalReport results={makeResults(over)} file="x.json" deployedCommit={deployedCommit} />);
  const NOTE = /the agent deployed here/;

  it("warns, before the figures, when the deployed commit is not the measured one", () => {
    renderWith("9999999c2d4e5f60718293a4b5c6d7e8f901234");
    const note = screen.getByText(NOTE).closest("[role=note]") as HTMLElement;
    expect(note).toHaveTextContent("Measured on commit abc1234; the agent deployed here (9999999) is not that one.");
    expect(note).toHaveTextContent(/may have changed since/);
    const summary = screen.getByRole("heading", { name: "Summary", hidden: true });
    expect(note.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says so when the file has no commit to compare", () => {
    renderWith("9999999c2d4e", { commit: null });
    const note = screen.getByText(NOTE).closest("[role=note]") as HTMLElement;
    expect(note).toHaveTextContent("Measured on an unknown commit; the agent deployed here (9999999) is not that one.");
  });

  it("says nothing when the deployed commit is the measured one", () => {
    renderWith("abc1234ffffffffffffffffffffffffffffffff");
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it("says nothing when no deployed commit is known (local development)", () => {
    renderWith(undefined);
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});

describe("EvalEmpty", () => {
  it("shows no figure, only how to produce one", () => {
    render(<EvalEmpty />);
    expect(screen.getByText(/No evaluation has been committed yet/)).toBeInTheDocument();
    expect(screen.getByText("npm run eval -- --runs 3")).toBeInTheDocument();
  });
});
