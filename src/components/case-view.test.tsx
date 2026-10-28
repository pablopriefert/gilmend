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

    // Assessment and claim numbers come from the case, formatted (the decision card repeats the
    // amount and the deadline, so each is read in its own card)
    expect(screen.getByText("Broken product")).toBeInTheDocument();
    const claimCard = screen.getByRole("region", { name: "Carrier claim" });
    expect(within(claimCard).getByText("€55.20")).toBeInTheDocument();
    expect(within(claimCard).getByText(/Computed by code from the carrier's rules, not by the model/)).toBeInTheDocument();
    expect(within(claimCard).getByText("2 Nov 2026")).toBeInTheDocument();
    expect(within(claimCard).getByText("6 days left")).toBeInTheDocument();

    // Evidence: original and SAM-annotated photo, served through /api/files
    const original = screen.getByAltText("Customer photo 1");
    expect(original).toHaveAttribute("src", "/api/files?p=uploads%2Frpt-1%2Fphoto-1.jpg");
    const annotated = screen.getByAltText("Photo 1 outlined by SAM 3.1");
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

  it("lists every step of the reasoning trace on a timeline, with who did it, and opens a tool's input and output on demand", () => {
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    const trace = screen.getByRole("region", { name: "Agent reasoning trace" });
    expect(within(trace).getByText("3 steps")).toBeInTheDocument();
    expect(within(trace).getByRole("region", { name: "Reasoning steps, newest first" })).toBeInTheDocument();
    expect(within(trace).getByText("Looked up order #1001")).toBeInTheDocument();
    expect(within(trace).getByText("Computed the claim")).toBeInTheDocument();
    // Who did each step is written down: the code looked up the order, the model is named by its engine.
    expect(within(trace).getByText(/^Code · get_order · \+0 ms$/)).toBeInTheDocument();
    expect(within(trace).getByText(/^Code · compute_claim · \+4\.0 s$/)).toBeInTheDocument();
    // Input and output stay behind the step until it is opened.
    expect(within(trace).queryByText(/"orderNumber": "#1001"/)).not.toBeInTheDocument();
    fireEvent.click(within(trace).getByRole("button", { name: /Looked up order #1001/ }));
    expect(within(trace).getByText(/"orderNumber": "#1001"/)).toBeInTheDocument();
    expect(within(trace).getByText("Output")).toBeInTheDocument();
  });

  it("names the model, SAM and the code in the trace, highlights a guardrail and says when the photos were not read", () => {
    const base = makeCase();
    const at = (s: number) => `2026-10-28T07:00:${String(s).padStart(2, "0")}.000Z`;
    const c = makeCase({
      trace: [
        { step: "Report received (1 photo(s) attached)", at: at(0) },
        { step: "Model note (step 1)", output: "Checking the order first.", at: at(1) },
        { step: "Tool: get_order", tool: "get_order", input: {}, output: { found: true }, at: at(2) },
        { step: "Tool: assess_photos", tool: "assess_photos", input: {}, output: {}, at: at(3) },
        { step: "Tool: mark_damage", tool: "mark_damage", input: {}, output: {}, at: at(4) },
        { step: "Guardrail: confidence capped at 0.6 because the photos are blurry.", at: at(5) },
        { step: "The photos were NOT read by the model (no image input). Nothing in this case comes from looking at them: it goes to a human.", at: at(6) },
        { step: "Case ready for review: refund (needs a human)", at: at(7) },
      ],
      decision: { ...base.decision!, needsHuman: true },
    });
    render(<CaseView caseRecord={c} rules={makeRules()} now={NOW} />);
    const trace = screen.getByRole("region", { name: "Agent reasoning trace" });
    // Raw tool names from the loop become sentences; the model is named by its engine.
    expect(within(trace).getByText("Looked up the order")).toBeInTheDocument();
    expect(within(trace).getByText("Read the photos and described the damage")).toBeInTheDocument();
    expect(within(trace).getByText("Outlined what SAM matched on the photo")).toBeInTheDocument();
    expect(within(trace).getByText(/^Muse Spark 1\.3 · assess_photos/)).toBeInTheDocument();
    expect(within(trace).getByText(/^SAM 3\.1 · mark_damage/)).toBeInTheDocument();
    expect(within(trace).getByText(/^Guardrail \(code\)/)).toBeInTheDocument();
    expect(within(trace).getByText(/^Warning/)).toBeInTheDocument();
    // The guardrail line is marked for the highlight (and keeps its own icon and word).
    const guardrail = within(trace).getByText(/Guardrail: confidence capped/).closest("li");
    expect(guardrail?.querySelector('[data-kind="guardrail"]')).not.toBeNull();
    // The page says up front that the model never saw the photos, in the agent's own words.
    const notes = screen.getAllByRole("note");
    expect(notes.some((n) => /Photos not read\..*NOT read by the model/.test(n.textContent ?? ""))).toBe(true);
  });

  it("does not call a mock 'Muse' in the trace", () => {
    const c = makeCase({
      engine: "demo-mock",
      trace: [{ step: "Tool: assess_photos", tool: "assess_photos", input: {}, output: {}, at: "2026-10-28T07:00:01.000Z" }],
    });
    render(<CaseView caseRecord={c} rules={makeRules()} now={NOW} />);
    const trace = screen.getByRole("region", { name: "Agent reasoning trace" });
    expect(within(trace).getByText(/^Scripted mock \(not Muse\) · assess_photos/)).toBeInTheDocument();
    expect(within(trace).queryByText(/Muse Spark 1\.3 · /)).not.toBeInTheDocument();
  });

  it("says what the SAM outline is, and that it goes in the claim only when there is a claim", () => {
    const { unmount } = render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    expect(
      screen.getByText("Outlined by SAM 3.1: what it matched (the item, its pieces or the box). This image goes in the claim"),
    ).toBeInTheDocument();
    unmount();
    const base = makeCase();
    const noClaim = makeCase({ decision: { ...base.decision!, carrierClaim: false, decision: "refund" } });
    render(<CaseView caseRecord={noClaim} rules={makeRules()} now={NOW} />);
    expect(
      screen.getByText("Outlined by SAM 3.1: what it matched (the item, its pieces or the box)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/goes in the claim/)).toBeNull();
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

    rerender(
      <CaseView caseRecord={withNote({ model: "muse-voice-transcribe-1.0", durationMs: 12_400, demo: false, edited: false, partial: true })} rules={makeRules()} now={NOW} />,
    );
    expect(screen.getByText(/sent as transcribed, with typed text added/)).toBeInTheDocument();
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

describe("case page: the decision card and the layout", () => {
  it("puts the decision card, then the actions, before the evidence in reading order (a phone shows them first)", () => {
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    const decision = screen.getByRole("region", { name: "Decision" });
    const review = screen.getByRole("region", { name: "Your review" });
    const evidence = screen.getByRole("region", { name: "Customer report and evidence" });
    expect(decision.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(review.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the decision card at its full height in the scrolling right column (shrink-0, 28 Oct 2026)", () => {
    // jsdom has no layout: this pins the class that stops the column from cropping the card.
    // Without it, overflow-hidden lets flex shrink the card to ~236 px and hides the confidence,
    // the deadline and the maximum amount at 1440x900.
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    const card = screen.getByRole("region", { name: "Decision" });
    expect(card).toHaveClass("shrink-0");
    expect(card.parentElement).toHaveClass("flex-col", "lg:overflow-y-auto");
  });

  it("shows the decision as a word, the carrier claim as yes or no, and the money with its deadline", () => {
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    const card = screen.getByRole("region", { name: "Decision" });
    expect(within(card).getByTestId("decision-kind")).toHaveTextContent("Reship");
    expect(within(card).getByText("yes")).toBeInTheDocument();
    expect(within(card).getByText("Maximum compensation")).toBeInTheDocument();
    // The animated counter keeps the whole amount as text for screen readers.
    expect(within(card).getByText("€55.20")).toBeInTheDocument();
    expect(within(card).getByText("6 days left")).toBeInTheDocument();
    expect(within(card).getByText("2 Nov 2026")).toBeInTheDocument();
    expect(within(card).getByText(/Not a promise of payment/)).toBeInTheDocument();
    expect(within(card).getByRole("meter")).toHaveAttribute("aria-valuenow", "86");
    expect(within(card).queryByRole("note")).not.toBeInTheDocument();
  });

  it("says no carrier claim, and shows no money, when the claim is not eligible", () => {
    const base = makeCase();
    const c = makeCase({
      decision: { ...base.decision!, carrierClaim: false, decision: "ask_more_photos" },
      claim: { ...base.claim!, eligible: false, maxCompensationEur: 0, claimDeadline: null, reserveDeadline: null, daysLeft: null },
    });
    render(<CaseView caseRecord={c} rules={makeRules()} now={NOW} />);
    const card = screen.getByRole("region", { name: "Decision" });
    expect(within(card).getByText("no")).toBeInTheDocument();
    expect(within(card).getByText("Not recoverable")).toBeInTheDocument();
    expect(within(card).getByText("No deadline")).toBeInTheDocument();
  });

  it("reads a past deadline as overdue, and a recorded run as of the recording", () => {
    const late = new Date("2026-11-10T09:00:00.000Z");
    const { unmount } = render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={late} />);
    expect(within(screen.getByRole("region", { name: "Decision" })).getByText("Overdue")).toBeInTheDocument();
    unmount();
    const recorded = makeCase({ createdAt: "2026-10-28T07:00:00.000Z", recorded: { recordedOn: "2026-10-28" } });
    render(<CaseView caseRecord={recorded} rules={makeRules()} now={late} />);
    const card = screen.getByRole("region", { name: "Decision" });
    expect(within(card).queryByText("Overdue")).not.toBeInTheDocument();
    expect(within(card).getByText("Counted as of the recording, not as of today.")).toBeInTheDocument();
  });

  it("repeats the honest wording on the evidence: what SAM matched, not a verdict on the damage", () => {
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    const evidence = screen.getByRole("region", { name: "Customer report and evidence" });
    expect(within(evidence).getByText(/not a verdict on the damage/)).toBeInTheDocument();
    expect(within(evidence).getByText("Photo 1, as sent by the customer")).toBeInTheDocument();
  });

  it("gives the status an icon and a word", () => {
    render(<CaseView caseRecord={makeCase({ status: "approved" })} rules={makeRules()} now={NOW} />);
    const chip = document.querySelector('[data-status="approved"]')!;
    expect(chip).toHaveTextContent("Approved");
    expect(chip.querySelector("svg")).not.toBeNull();
  });

  it("confirms an approval with a toast as well as in the page, and the toast never replaces the page's own message", async () => {
    mockPatch({ ok: true, body: { case: makeCase({ status: "approved" }) } });
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Case approved")).toBeInTheDocument();
    expect(await screen.findByText(/Approved: ready to send/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has left Gilmend/)).toBeInTheDocument();
  });

  it("copies the claim e-mail with its subject, and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy e-mail" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toBe(
      "Subject: Damage claim, tracking 6A99001001001\n\nDear claims department,\n\nPlease find our claim attached.",
    );
    expect(await screen.findByText("E-mail copied")).toBeInTheDocument();
  });

  it("says it when the browser refuses to copy the reply", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy reply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not copy/);
  });
});
