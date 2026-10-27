// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_FOLLOW_UPS, snapshotRound } from "@/lib/rounds";
import type { CaseRecord, Decision, FollowUp } from "@/lib/types";
import { CaseView } from "./case-view";
import { clearRoundsFocusRequest } from "./case/rounds-focus";
import { DEMO_FOLLOW_UP, isBlurryLampCase } from "./demo-scenarios";
import { NOW, makeCase, makeRules } from "./fixtures";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
  usePathname: () => "/cases/case-1",
}));

const asking: Decision = {
  decision: "ask_more_photos",
  carrierClaim: false,
  confidence: 0.9,
  reasons: ["The photo is too blurry to judge the damage."],
  needsHuman: false,
  customerReply: "Hello,\n\nCould you send one or two sharper photos of the lamp?",
};

/** The case of the follow-up loop: the agent asked for sharper photos. */
function blurry(over: Partial<CaseRecord> = {}): CaseRecord {
  const base = makeCase();
  return makeCase({
    assessment: { ...base.assessment!, damageType: "unclear", severity: "none", photoQuality: "blurry", packagingAdequate: null },
    claim: null,
    decision: asking,
    document: null,
    evidence: [],
    ...over,
  });
}

const lampReport = { orderNumber: "#1003", customerEmail: "ines.moreau@example.org" };
const image = (name = "sharp.jpg", type = "image/jpeg", size = 2000) => new File([new Uint8Array(size)], name, { type });
const attach = (...files: File[]) =>
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files } });

const jsonResponse = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

function view(c: CaseRecord, props: Partial<React.ComponentProps<typeof CaseView>> = {}) {
  return render(<CaseView caseRecord={c} rules={makeRules()} now={NOW} {...props} />);
}
const panel = () => screen.getByRole("region", { name: "The customer replied" });
const run = () => fireEvent.click(screen.getByRole("button", { name: /Run the agent again/ }));

beforeEach(() => {
  refresh.mockReset();
  push.mockReset();
  clearRoundsFocusRequest();
  let n = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:photo-${n++}`, revokeObjectURL: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe("the 'The customer replied' panel: when it shows", () => {
  it("shows on a case that asked for more photos, and says what it does and what was asked", () => {
    view(blurry());
    const p = panel();
    expect(within(p).getByText(/The agent asked the customer for more photos\./)).toBeInTheDocument();
    expect(within(p).getByText(/Nothing is sent to the customer/)).toBeInTheDocument();
    expect(within(p).getByText("Starts round 2")).toBeInTheDocument();
    // What the customer was asked is one click away
    fireEvent.click(within(p).getByText("What the customer was asked"));
    expect(within(p).getByText(/Could you send one or two sharper photos of the lamp\?/)).toBeInTheDocument();
    expect(within(p).getByRole("button", { name: "Run the agent again (round 2)" })).toBeEnabled();
  });

  it("is not there when the agent asked for nothing, for an unfinished or rejected case, or when the cap is reached", () => {
    const { unmount } = view(makeCase());
    expect(screen.queryByRole("region", { name: "The customer replied" })).not.toBeInTheDocument();
    unmount();
    const none = view(blurry({ status: "new", decision: null }));
    expect(screen.queryByRole("region", { name: "The customer replied" })).not.toBeInTheDocument();
    none.unmount();
    const rejected = view(blurry({ status: "rejected" }));
    expect(screen.queryByRole("region", { name: "The customer replied" })).not.toBeInTheDocument();
    rejected.unmount();
    const reply: FollowUp = { id: "a", receivedAt: "2026-10-28T10:00:00.000Z", message: "x", photos: [] };
    view(blurry({ followUps: Array.from({ length: MAX_FOLLOW_UPS }, (_, i) => ({ ...reply, id: `r${i}` })) }));
    expect(screen.queryByRole("region", { name: "The customer replied" })).not.toBeInTheDocument();
  });

  it("stays on an approved request (the customer answers after it went out) and shows the round it would start", () => {
    view(blurry({ status: "approved" }));
    expect(within(panel()).getByText("Starts round 2")).toBeInTheDocument();
  });

  it("asks for the order number when the agent could not find the order, and only then", () => {
    const lost = blurry({
      order: null,
      decision: { ...asking, decision: "no_action", needsHuman: true, customerReply: "Which order is it?" },
      assessment: null,
    });
    const { unmount } = view(lost);
    expect(within(panel()).getByText(/^The agent could not find the order\./)).toBeInTheDocument();
    expect(within(panel()).getByLabelText("Corrected order number")).toBeInTheDocument();
    unmount();
    view(blurry());
    expect(screen.queryByLabelText("Corrected order number")).not.toBeInTheDocument();
  });

  it("names the engine it will really run on: the labelled mock when the server has no key", () => {
    view(blurry(), { followUpEngine: { engine: "demo-mock" } });
    expect(within(panel()).getByText(/^Will run on/)).toBeInTheDocument();
    expect(within(panel()).getByText("DEMO MODE: scripted answers, no model is called.")).toBeInTheDocument();
  });
});

describe("the 'The customer replied' panel: sending a reply", () => {
  it("refuses an empty reply and calls nothing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    view(blurry());
    run();
    expect(within(panel()).getByText("Add what the customer wrote, or at least one photo.")).toBeInTheDocument();
    expect(screen.getByLabelText("What the customer wrote")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("What the customer wrote")).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains a photo of the wrong type as soon as it is picked, and does not send it", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    view(blurry());
    attach(image("doc.pdf", "application/pdf"));
    expect(screen.getByRole("alert")).toHaveTextContent(/doc\.pdf is not an accepted file type/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the words, the photos and the round to the follow-up route, then refreshes the case", async () => {
    let settle!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (settle = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    view(blurry());

    fireEvent.change(screen.getByLabelText("What the customer wrote"), { target: { value: "Here is a sharper photo." } });
    attach(image("a.jpg"), image("b.jpg"));
    run();

    // While the agent works: the form is busy, the button says so, the page announces it.
    expect(await screen.findByTestId("agent-working")).toBeInTheDocument();
    expect(screen.getByTestId("follow-up-form")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Running the agent…" })).toBeDisabled();
    expect(screen.getByText("The agent is re-reading the case (round 2).")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/cases/case-1/follow-up");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("message")).toBe("Here is a sharper photo.");
    expect(body.get("round")).toBe("1");
    expect(body.has("orderNumber")).toBe(false);
    expect(body.getAll("photos").map((f) => (f as File).name)).toEqual(["a.jpg", "b.jpg"]);

    settle(jsonResponse(201, { caseId: "case-1", forkedFrom: null, round: 2, decision: "reship", engine: "demo-mock", fellBack: false }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
    expect(await screen.findByText("Round 2 is ready")).toBeInTheDocument();
    expect(screen.getByText(/Decision: Reship/)).toBeInTheDocument();
  });

  it("opens the new case when the reply was saved as a fork of a recorded run, instead of refreshing this one", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { caseId: "case-1-followup-0a1b2c3d", forkedFrom: "case-1", round: 2, decision: "reship", engine: "muse-spark-1.3", fellBack: false }),
    );
    vi.stubGlobal("fetch", fetchMock);
    view(blurry({ recorded: { recordedOn: "2026-10-27" } }));
    fireEvent.change(screen.getByLabelText("What the customer wrote"), { target: { value: "Here is a sharper photo." } });
    run();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/cases/case-1-followup-0a1b2c3d"));
    expect(refresh).not.toHaveBeenCalled();
    expect(await screen.findByText("Round 2 is ready")).toBeInTheDocument();
    expect(screen.getByText(/ran again on a copy of this recorded run\. Decision: Reship\. The recording stays as it was\./)).toBeInTheDocument();
  });

  it("sends the access code of the page with the reply, and shares the field with the review card", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { round: 2, decision: "reship" }));
    vi.stubGlobal("fetch", fetchMock);
    view(blurry(), { accessCodeRequired: true });

    // Without the code the page does not even ask the server.
    fireEvent.change(screen.getByLabelText("What the customer wrote"), { target: { value: "Sharper photo attached." } });
    run();
    expect(await screen.findByText(/Enter the access code from the submission/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // One code for the page: typing it in the review card fills the panel's field too.
    const fields = screen.getAllByLabelText("Access code");
    expect(fields).toHaveLength(2);
    fireEvent.change(fields[0], { target: { value: "judges-2026" } });
    expect(screen.getAllByLabelText("Access code")[1]).toHaveValue("judges-2026");
    run();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["x-access-code"]).toBe("judges-2026");
  });

  it("shows the server's refusal, keeps what was typed, and lets the merchant try again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(409, { error: "stale_round", message: "This case has changed since you opened it (another reply was added). Reload the page to see the latest round." }))
      .mockResolvedValueOnce(jsonResponse(201, { round: 2, decision: "reship" }));
    vi.stubGlobal("fetch", fetchMock);
    view(blurry());
    fireEvent.change(screen.getByLabelText("What the customer wrote"), { target: { value: "Here it is." } });
    run();
    expect(await screen.findByText(/This case has changed since you opened it/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("What the customer wrote")).toHaveValue("Here it is.");
    expect(screen.getByRole("button", { name: /Run the agent again/ })).toBeEnabled();
    run();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("asks for the access code again when the server refuses it (401)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: "access_code_required", message: "Adding the customer's reply on this public demo needs the access code from the submission." })));
    view(blurry());
    expect(screen.queryByLabelText("Access code")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What the customer wrote"), { target: { value: "Here it is." } });
    run();
    expect(await screen.findByText(/needs the access code from the submission/)).toBeInTheDocument();
    expect(screen.getAllByLabelText("Access code").length).toBeGreaterThan(0);
  });

  it("says so when the reply could not reach the server, and changes nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    view(blurry());
    fireEvent.change(screen.getByLabelText("What the customer wrote"), { target: { value: "Here it is." } });
    run();
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sends the corrected order number only when the case has none", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { round: 2, decision: "reship" }));
    vi.stubGlobal("fetch", fetchMock);
    view(
      blurry({
        order: null,
        assessment: null,
        decision: { ...asking, decision: "no_action", needsHuman: true, customerReply: "Which order is it?" },
      }),
    );
    fireEvent.change(screen.getByLabelText("Corrected order number"), { target: { value: "#1001" } });
    fireEvent.change(screen.getByLabelText("What the customer wrote"), { target: { value: "Sorry, it is #1001." } });
    run();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(body.get("orderNumber")).toBe("#1001");
  });
});

describe("the demo button: simulate the customer's reply", () => {
  const lamp = () => blurry({ report: { ...makeCase().report, ...lampReport, message: "My lamp is damaged, I think the glass is cracked." } });

  it("is on the blurry-lamp case only (by what the customer filed, never by a path)", () => {
    expect(isBlurryLampCase(lamp())).toBe(true);
    expect(isBlurryLampCase({ report: { orderNumber: "1003", customerEmail: "Ines.Moreau@example.org" } })).toBe(true);
    expect(isBlurryLampCase(makeCase())).toBe(false);
    expect(isBlurryLampCase({ report: { orderNumber: "#1003", customerEmail: "someone@else.example" } })).toBe(false);

    const { unmount } = view(blurry());
    expect(screen.queryByRole("button", { name: "Demo: simulate the customer's reply" })).not.toBeInTheDocument();
    unmount();
    view(lamp());
    expect(screen.getByRole("button", { name: "Demo: simulate the customer's reply" })).toBeInTheDocument();
  });

  it("loads the sharp photo and a short message into the form, says what the photo is, and sends nothing yet", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === DEMO_FOLLOW_UP.photoSrc) {
        return { ok: true, status: 200, blob: async () => new Blob([new Uint8Array(2000)], { type: "image/webp" }) } as Response;
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    view(lamp());
    fireEvent.click(screen.getByRole("button", { name: "Demo: simulate the customer's reply" }));

    await waitFor(() => expect(screen.getByLabelText("What the customer wrote")).toHaveValue(DEMO_FOLLOW_UP.message));
    expect(screen.getByText("lamp-sharp.webp")).toBeInTheDocument();
    expect(screen.getByText("Demo reply loaded. Review it, then run the agent again.")).toBeInTheDocument();
    // Honest about what it is
    expect(within(panel()).getByText(/generated with Meta's Muse Image/)).toBeInTheDocument();
    expect(within(panel()).getByText(/the case will say the reply is simulated/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/demo-photo?name=lamp-sharp");
  });

  it("then sends the demo photo like any other reply", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === DEMO_FOLLOW_UP.photoSrc) {
        return { ok: true, status: 200, blob: async () => new Blob([new Uint8Array(2000)], { type: "image/webp" }) } as Response;
      }
      return jsonResponse(201, { round: 2, decision: "reship" });
    });
    vi.stubGlobal("fetch", fetchMock);
    view(lamp());
    fireEvent.click(screen.getByRole("button", { name: "Demo: simulate the customer's reply" }));
    await waitFor(() => expect(screen.getByLabelText("What the customer wrote")).toHaveValue(DEMO_FOLLOW_UP.message));
    run();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("/api/cases/case-1/follow-up");
    const body = init.body as FormData;
    expect(body.get("message")).toBe(DEMO_FOLLOW_UP.message);
    expect(body.getAll("photos").map((f) => (f as File).name)).toEqual(["lamp-sharp.webp"]);
  });

  it("says so when the demo photo cannot be loaded, and leaves the form alone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, {})));
    view(lamp());
    fireEvent.click(screen.getByRole("button", { name: "Demo: simulate the customer's reply" }));
    expect(await screen.findByText("Could not load the demo photo. Add a photo of your own instead.")).toBeInTheDocument();
    expect(screen.getByLabelText("What the customer wrote")).toHaveValue("");
  });
});

describe("a case that was followed up", () => {
  const first = blurry({ status: "approved" });
  const followUp: FollowUp = {
    id: "fu-1",
    receivedAt: "2026-10-29T09:00:00.000Z",
    message: "Here is a sharper photo, the glass shade is cracked.",
    photos: ["data/runtime/uploads/fu-1/photo-1.webp"],
  };
  const second = (over: Partial<CaseRecord> = {}): CaseRecord =>
    makeCase({
      report: first.report,
      followUps: [followUp],
      previousRounds: [snapshotRound(first)],
      engine: "demo-mock",
      updatedAt: "2026-10-29T09:01:00.000Z",
      trace: [
        { step: "Report received (1 photo(s) attached)", at: "2026-10-28T07:00:00.000Z" },
        { step: "Case ready for review: ask_more_photos", at: "2026-10-28T07:00:08.000Z" },
        { step: "Round 2 starts: the customer replied (a message, 1 new photo). The agent resumes this same case with what it concluded in round 1.", at: "2026-10-29T09:00:01.000Z", round: 2 },
        { step: "Case ready for review: reship", at: "2026-10-29T09:00:09.000Z", round: 2 },
      ],
      ...over,
    });

  it("shows the rounds, what changed between them, and the customer's reply with its photo", () => {
    view(second());
    expect(screen.getByTestId("round-chip")).toHaveTextContent("Round 2: the customer replied");
    const rounds = screen.getByTestId("rounds");
    expect(within(rounds).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Round 1", "Round 2latest"]);
    const changes = screen.getByTestId("round-2-changes");
    expect(changes).toHaveTextContent("What changed since round 1");
    expect(changes).toHaveTextContent("Decision:Ask for more photosbecameReship");
    expect(changes).toHaveTextContent("Damage read:UnclearbecameBroken product");
    expect(changes).toHaveTextContent("Photo quality:BlurrybecameGood");
    expect(changes).toHaveTextContent("Carrier claim:NonebecameUp to €55.20");
    // The reply is in the round list and with the evidence, photos numbered across the case
    expect(within(rounds).getByText(/Here is a sharper photo, the glass shade is cracked\./)).toBeInTheDocument();
    expect(screen.getByAltText("Customer photo 1")).toBeInTheDocument();
    expect(screen.getByAltText("Customer photo 2")).toHaveAttribute("src", "/api/files?p=uploads%2Ffu-1%2Fphoto-1.webp");
    expect(screen.getByTestId("follow-up-2")).toHaveTextContent("Round 2: the customer replied");
    // The page describes the latest round
    expect(screen.getByTestId("decision-kind")).toHaveTextContent("Reship");
    // The settled case no longer offers a reply
    expect(screen.queryByRole("region", { name: "The customer replied" })).not.toBeInTheDocument();
  });

  it("says which engine ran each round: a recording in round 1, the labelled mock in round 2", () => {
    const recordedFirst = { ...first, recorded: { recordedOn: "2026-10-27" } };
    view(second({ previousRounds: [snapshotRound(recordedFirst)] }));
    const rounds = screen.getByTestId("rounds");
    const [r1, r2] = within(rounds).getAllByRole("listitem").filter((li) => li.hasAttribute("data-round"));
    expect(within(r1).getByLabelText(/^Muse Spark 1\.3/)).toBeInTheDocument();
    expect(within(r1).getByLabelText(/^Recorded run/)).toBeInTheDocument();
    expect(within(r2).getByLabelText(/^DEMO MODE/)).toBeInTheDocument();
    // The case is no longer the recording: no recorded banner on the page, but the demo-mode one is there
    expect(screen.queryByTestId("recorded-note")).not.toBeInTheDocument();
    expect(screen.getAllByRole("note").some((n) => /The latest round of this case was produced by a deterministic mock/.test(n.textContent ?? ""))).toBe(true);
  });

  it("labels a simulated reply as simulated, in the rounds and with the evidence", () => {
    view(second({ followUps: [{ ...followUp, simulated: true }] }));
    expect(screen.getAllByText("Simulated reply")).toHaveLength(2);
    expect(screen.getAllByText(/Not written by a customer/).length).toBeGreaterThan(0);
  });

  it("moves the focus to the title of the rounds card once the reply is processed (the panel that had it is gone)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { caseId: "case-1", forkedFrom: null, round: 2, decision: "reship", engine: "demo-mock", fellBack: false }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = view(first);
    fireEvent.change(screen.getByLabelText("What the customer wrote"), { target: { value: "Here is a sharper photo." } });
    run();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // router.refresh() brings the server-side case: round 2 is settled, the panel is gone, the rounds card appears.
    rerender(<CaseView caseRecord={second()} rules={makeRules()} now={NOW} />);
    const title = screen.getByRole("heading", { name: "Rounds of this case" });
    expect(title).toHaveAttribute("tabindex", "-1");
    await waitFor(() => expect(title).toHaveFocus());
  });

  it("does not take the focus when nobody just sent a reply (opening a followed-up case, or a later refresh)", () => {
    view(second());
    expect(document.body).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Rounds of this case" })).not.toHaveFocus();
  });

  it("says a case continues a recorded run, with a way back to it, and that a simulated reply is not counted", () => {
    view(second({ id: "case-1-followup-0a1b2c3d", followedFrom: "case-1", followUps: [{ ...followUp, simulated: true }] }));
    const from = screen.getByTestId("followed-from-note");
    expect(from).toHaveTextContent(/continues a recorded run/);
    expect(within(from).getByRole("link", { name: "Open the recording" })).toHaveAttribute("href", "/cases/case-1");
    expect(screen.getByTestId("simulated-reply-note")).toHaveTextContent(/No customer wrote it\. The case is not counted in the totals/);
  });

  it("shows neither note on an ordinary case with a real reply", () => {
    view(second());
    expect(screen.queryByTestId("followed-from-note")).not.toBeInTheDocument();
    expect(screen.queryByTestId("simulated-reply-note")).not.toBeInTheDocument();
  });

  it("cuts the trace into rounds, newest first, each with its own timeline", () => {
    view(second());
    const trace = screen.getByRole("region", { name: "Agent reasoning trace" });
    expect(within(trace).getByText("4 steps")).toBeInTheDocument();
    const [newest, oldest] = within(trace).getAllByRole("heading", { level: 3 }).filter((h) => /^Round \d/.test(h.textContent ?? ""));
    expect(newest).toHaveTextContent("Round 2");
    expect(newest).toHaveTextContent("the customer's reply · 2 steps");
    expect(oldest).toHaveTextContent("Round 1");
    expect(within(screen.getByTestId("trace-round-2")).getByText(/Round 2 starts: the customer replied/)).toBeInTheDocument();
    expect(within(screen.getByTestId("trace-round-1")).getByText(/Report received/)).toBeInTheDocument();
  });

  it("a case that was never followed up looks as it did: no rounds, no round chip, one timeline", () => {
    view(makeCase());
    expect(screen.queryByTestId("rounds")).not.toBeInTheDocument();
    expect(screen.queryByTestId("round-chip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trace-round-1")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Round 1: the report/)).not.toBeInTheDocument();
  });

  it("says what a round with no change looks like, and keeps a lost record honest", () => {
    // Round 2 reached the same decision and figures as round 1: nothing to list.
    const same = second({ decision: asking, claim: null, assessment: first.assessment, document: null });
    view(same);
    expect(screen.getByTestId("round-2-changes")).toHaveTextContent("Nothing: same decision, same figures.");
  });
});
