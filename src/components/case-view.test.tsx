// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, makeCase, makeRules, makeRulesWithFigures } from "./fixtures";
import { CaseView } from "./case-view";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/cases/case-1",
}));

function mockPatch(response: { ok: boolean; body: unknown; status?: number }) {
  const fetchMock = vi.fn(
    async () => ({ ok: response.ok, status: response.status ?? (response.ok ? 200 : 400), json: async () => response.body }) as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => refresh.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("case page: public deployment and unfinished cases", () => {
  it("shows the access-code field only when the server asks for one, and sends the code with the change", async () => {
    const fetchMock = mockPatch({ ok: true, body: { case: makeCase({ status: "approved" }) } });
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} accessCodeRequired />);
    fireEvent.change(screen.getByLabelText("Access code"), { target: { value: "judges-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["x-access-code"]).toBe("judges-2026");
  });

  it("has no access-code field on a local run", () => {
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    expect(screen.queryByLabelText("Access code")).not.toBeInTheDocument();
  });

  it("asks for the code when the server refuses a change with 401", async () => {
    mockPatch({ ok: false, status: 401, body: { error: "access_code_required", message: "Enter the access code of this demo to change a case." } });
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/access code/);
    expect(screen.getByLabelText("Access code")).toBeInTheDocument();
  });

  it("says when the agent has not finished a case (saved as 'new' before the run)", () => {
    render(<CaseView caseRecord={makeCase({ status: "new", decision: null })} rules={null} now={NOW} />);
    expect(screen.getByRole("note")).toHaveTextContent(/has not finished this case/);
  });
});

describe("case page: a needs_review case", () => {
  it("shows the header, decision, claim, evidence and trace", () => {
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("#1001");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Camille Laurent");
    expect(document.querySelector('[data-status="needs_review"]')).toHaveTextContent("Needs review");
    expect(screen.getByText(/Muse Spark 1\.3 \(Meta Model API\)/)).toBeInTheDocument();

    // Decision
    expect(screen.getByTestId("decision-kind")).toHaveTextContent("Reship");
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "86");
    expect(screen.getByText("Clear breakage on a 58 EUR item.")).toBeInTheDocument();

    // Assessment and claim numbers come from the case, formatted
    expect(screen.getByText("Broken product")).toBeInTheDocument();
    expect(screen.getByText("€55.20")).toBeInTheDocument();
    expect(screen.getByText(/Computed by code from the carrier's rules, not by the model/)).toBeInTheDocument();
    expect(screen.getByText("2 Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("6 days left")).toBeInTheDocument();

    // Evidence: original and SAM-annotated photo, served through /api/files
    const original = screen.getByAltText("Customer photo 1");
    expect(original).toHaveAttribute("src", "/api/files?p=uploads%2Frpt-1%2Fphoto-1.jpg");
    const annotated = screen.getByAltText("Photo 1 with the damaged area outlined");
    expect(annotated).toHaveAttribute("src", "/api/files?p=evidence%2Frpt-1%2Fphoto-1-annotated.png");
    expect(screen.getByText("Annotated with SAM 3.1")).toBeInTheDocument();

    // Claim document: PDF preview and e-mail
    expect(screen.getByTitle("Carrier claim PDF preview")).toHaveAttribute("src", "/api/cases/case-1/pdf");
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute(
      "href",
      "/api/cases/case-1/pdf?download=1",
    );
    expect(screen.getByText("Damage claim, tracking 6A99001001001")).toBeInTheDocument();

    // The reply is the agent's draft, read-only until Edit
    const reply = screen.getByLabelText("Text of the reply");
    expect(reply).toHaveValue(makeCase().decision!.customerReply);
    expect(reply).toHaveAttribute("readonly");
    for (const name of ["Approve", "Edit", "Reject"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });

  it("shows sources with 'unverified' and stale flags, and never links a non-http URL", () => {
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    const claim = screen.getByRole("region", { name: "Carrier claim" });
    expect(within(claim).getByText("Unverified")).toBeInTheDocument();
    expect(within(claim).getByText("The 3-day reserve rule is applied to every carrier to be safe.")).toBeInTheDocument();
    expect(within(claim).queryByText(/^\[D\]/)).not.toBeInTheDocument();
    expect(within(claim).getByRole("link", { name: "Colissimo claims conditions" })).toHaveAttribute(
      "href",
      "https://example.com/colissimo",
    );
    // The javascript: source is shown as plain text, flagged as not re-checked recently.
    expect(within(claim).queryByRole("link", { name: "An old source" })).not.toBeInTheDocument();
    expect(within(claim).getByText("An old source")).toBeInTheDocument();
    expect(within(claim).getByText("Not re-checked recently")).toBeInTheDocument();
    expect(within(claim).getByText(/€23 per kg, capped at €690/)).toBeInTheDocument();
  });

  it("shows the status of every rule figure when the rules module provides them", () => {
    render(<CaseView caseRecord={makeCase()} rules={makeRulesWithFigures()} now={NOW} />);
    const claim = screen.getByRole("region", { name: "Carrier claim" });
    expect(within(claim).getByText("Figures and how sure we are")).toBeInTheDocument();
    const figures = within(claim).getAllByRole("listitem").filter((li) => li.textContent?.includes("checked 27 Oct 2026"));
    expect(figures).toHaveLength(3);
    expect(within(figures[0]).getByText("Dated source")).toBeInTheDocument();
    expect(within(figures[1]).getByText("Unverified")).toBeInTheDocument();
    expect(within(figures[2]).getByText("Verified")).toBeInTheDocument();
    // A "DATED SOURCE:" note is flagged and its tag stripped.
    expect(within(claim).getByText("Amounts come from the 2020 edition of the terms.")).toBeInTheDocument();
  });

  it("collapses the reasoning trace and lists every tool step", () => {
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    const trace = screen.getByRole("region", { name: "Agent reasoning trace" });
    const outer = trace.querySelector("details");
    expect(outer).not.toHaveAttribute("open");
    expect(within(trace).getByText("3 steps")).toBeInTheDocument();
    expect(within(trace).getByText("get_order")).toBeInTheDocument();
    expect(within(trace).getByText("Looked up order #1001")).toBeInTheDocument();
    // Tool input/output are inside a nested collapsed <details>
    const step = within(trace).getByText("Looked up order #1001").closest("details");
    expect(step).not.toHaveAttribute("open");
    expect(within(step as HTMLElement).getByText(/"orderNumber": "#1001"/)).toBeInTheDocument();
  });

  it("calls out a case that needs a human", () => {
    const base = makeCase();
    const c = makeCase({ decision: { ...base.decision!, needsHuman: true, decision: "refund" } });
    render(<CaseView caseRecord={c} rules={makeRules()} now={NOW} />);
    expect(screen.getByText(/Needs your judgement/)).toBeInTheDocument();
    expect(screen.getByTestId("decision-kind")).toHaveTextContent("Refund");
  });

  it("labels a demo-mode case so it is never mistaken for Muse", () => {
    render(<CaseView caseRecord={makeCase({ engine: "demo-mock" })} rules={makeRules()} now={NOW} />);
    expect(screen.getAllByText(/DEMO MODE/).length).toBeGreaterThan(0);
    expect(screen.getByText(/produced by a deterministic mock, not by Muse/)).toBeInTheDocument();
    expect(screen.queryByText(/Muse Spark 1\.3 \(Meta Model API\)/)).not.toBeInTheDocument();
  });

  it("copes with a case the agent could not investigate", () => {
    const c = makeCase({
      order: null,
      assessment: null,
      claim: null,
      decision: null,
      evidence: [],
      document: null,
      status: "new",
    });
    render(<CaseView caseRecord={c} rules={null} now={NOW} />);
    expect(screen.getByText(/No order matches/)).toBeInTheDocument();
    expect(screen.getByText(/did not reach a decision/)).toBeInTheDocument();
    expect(screen.getByText("The carrier rules could not be loaded for this case.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    // The customer's own photo still shows, raw.
    expect(screen.getByAltText("Customer photo 1")).toBeInTheDocument();
    expect(screen.getByText("Raw photo: not annotated")).toBeInTheDocument();
  });
});

describe("case page: approve, edit, reject", () => {
  function renderCase() {
    return render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
  }

  it("Approve marks the case approved, says it is ready to send and sends nothing", async () => {
    const approved = makeCase({ status: "approved" });
    const fetchMock = mockPatch({ ok: true, body: { case: approved } });
    renderCase();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await screen.findByText(/Approved: ready to send/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const [url, init] = calls[0];
    expect(url).toBe("/api/cases/case-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ status: "approved" });
    expect(screen.getByText(/sends nothing by itself/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen for review" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    // The only network call is the PATCH to our own API: no carrier, no customer.
    expect(fetchMock.mock.calls.every((c) => (c as unknown as [string])[0].startsWith("/api/cases/"))).toBe(true);
  });

  it("Edit lets the merchant change the reply, and Save stores it", async () => {
    const edited = makeCase({ decision: { ...makeCase().decision!, customerReply: "Hello, a new vase is coming." } });
    const fetchMock = mockPatch({ ok: true, body: { case: edited } });
    renderCase();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const reply = screen.getByLabelText("Text of the reply");
    expect(reply).not.toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Save edit" })).toBeDisabled(); // nothing changed yet
    fireEvent.change(reply, { target: { value: "Hello, a new vase is coming." } });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

    await waitFor(() => expect(screen.getByLabelText("Text of the reply")).toHaveAttribute("readonly"));
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ customerReply: "Hello, a new vase is coming." });
    expect(screen.getByLabelText("Text of the reply")).toHaveValue("Hello, a new vase is coming.");
  });

  it("Approve while editing sends the edited reply with it", async () => {
    const fetchMock = mockPatch({ ok: true, body: { case: makeCase({ status: "approved" }) } });
    renderCase();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Text of the reply"), { target: { value: "Edited text" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(/Approved: ready to send/);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ status: "approved", customerReply: "Edited text" });
  });

  it("Reject marks the case rejected and can be reopened", async () => {
    mockPatch({ ok: true, body: { case: makeCase({ status: "rejected" }) } });
    renderCase();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await screen.findByText(/Nothing was sent/);
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reopen for review" })).toBeInTheDocument();
  });

  it("shows the server's message and keeps the case unchanged when the save fails", async () => {
    mockPatch({ ok: false, body: { error: "not_found", message: "Case not found." } });
    renderCase();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Case not found.");
    expect(screen.queryByText(/Approved: ready to send/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("reports a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderCase();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the server/);
  });
});

describe("case page: voice message", () => {
  const withNote = (voiceNote: NonNullable<ReturnType<typeof makeCase>["report"]["voiceNote"]>) => {
    const c = makeCase();
    return makeCase({ report: { ...c.report, voiceNote } });
  };

  it("says which model transcribed a dictated message, and whether the customer edited it", () => {
    const { rerender } = render(
      <CaseView caseRecord={withNote({ model: "muse-voice-transcribe-1.0", durationMs: 12_400, demo: false, edited: false })} rules={makeRules()} now={NOW} />,
    );
    expect(screen.getByText("Voice message, transcribed by muse-voice-transcribe-1.0")).toBeInTheDocument();
    expect(screen.getByText(/12 s, sent as transcribed/)).toBeInTheDocument();

    rerender(
      <CaseView caseRecord={withNote({ model: "muse-voice-transcribe-1.0", durationMs: 12_400, demo: false, edited: true })} rules={makeRules()} now={NOW} />,
    );
    expect(screen.getByText(/edited by the customer after transcription/)).toBeInTheDocument();
  });

  it("never attributes a canned transcript to the speech model", () => {
    render(<CaseView caseRecord={withNote({ model: "demo-mock", durationMs: 3000, demo: true, edited: false })} rules={makeRules()} now={NOW} />);
    expect(screen.getByText("Voice message: DEMO MODE, canned transcript")).toBeInTheDocument();
    expect(screen.queryByText(/transcribed by muse-voice/)).not.toBeInTheDocument();
  });

  it("shows nothing about voice for a typed message", () => {
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    expect(screen.queryByText(/Voice message/)).not.toBeInTheDocument();
  });
});
