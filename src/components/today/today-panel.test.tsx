// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeEngine } from "@/lib/config";
import type { Provider } from "@/lib/providers";
import { runSweep } from "@/lib/sweep/run";
import { SWEEP_NOW, at, claimOf, openCase, waitingCase } from "@/lib/sweep/plan-helpers";
import { BRIEFING_SYSTEM } from "@/lib/sweep/text";
import type { SweepResult } from "@/lib/sweep/types";
import type { CaseRecord } from "@/lib/types";
import { CasesDashboard } from "../cases-dashboard";
import { makeCase } from "../fixtures";
import { TodayPanel } from "./today-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));

const NOW_ISO = SWEEP_NOW.toISOString();
let emptySweep: SweepResult;
beforeAll(async () => {
  emptySweep = await sweepOf([]);
});
const store = { load: async () => null, save: async () => {} };

async function sweepOf(cases: CaseRecord[], extra: { provider?: Provider; includeRecorded?: boolean } = {}): Promise<SweepResult> {
  const { sweep } = await runSweep({ trigger: "manual", now: SWEEP_NOW, env: {}, cases, store, ...extra });
  return sweep;
}

const fakeMuse = (answers: { briefing?: string; nudge?: string } = {}): Provider =>
  ({
    engine: "muse-spark-1.3",
    model: "muse-spark-1.3",
    isMock: false,
    detail: describeEngine("muse-spark-1.3"),
    chat: async (params: { messages: { content: unknown }[] }) => ({
      choices: [
        {
          message: {
            role: "assistant",
            content:
              params.messages[0].content === BRIEFING_SYSTEM
                ? (answers.briefing ?? "Start with {order:1}. The rest can wait.")
                : (answers.nudge ?? "Hello,\n\nWe are still waiting for sharper photos so we can move forward. Thank you!"),
          },
        },
      ],
    }),
  }) as unknown as Provider;

const cases = () => [openCase("1004", { deadlineHours: 17, eur: 25, carrier: "mondial_relay" }), waitingCase("1003", 70), openCase("1006", { deadlineHours: null, eur: 0 })];

const panel = (sweep: SweepResult | null, props: Partial<React.ComponentProps<typeof TodayPanel>> = {}) =>
  render(<TodayPanel sweep={sweep} now={NOW_ISO} accessCodeRequired={false} {...props} />);

function fetchMock(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const mock = vi.fn(async (url: string, init: RequestInit) => {
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubEnv("MODEL_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the plan", () => {
  it("lists the items in the order the code ranked them, each with a link to its case", async () => {
    panel(await sweepOf(cases()));
    const items = within(screen.getByRole("list", { name: "Today's plan" })).getAllByTestId("today-item");
    expect(items.map((li) => li.getAttribute("data-case-id"))).toEqual(["1004", "1003", "1006"]);
    for (const li of items) {
      const id = li.getAttribute("data-case-id");
      expect(within(li).getAllByRole("link").every((a) => a.getAttribute("href") === `/cases/${id}`)).toBe(true);
    }
    expect(within(items[0]).getByText("Review the case")).toBeInTheDocument();
  });

  it("says why each case is there, in the code's sentences", async () => {
    panel(await sweepOf(cases()));
    const [first, second] = screen.getAllByTestId("today-item");
    expect(within(first).getByText(/The claim deadline of Mondial Relay \(Offre Start\) closes Thu 29 Oct, 04:00\./)).toBeInTheDocument();
    expect(within(second).getByText(/Waiting for the customer: the request was approved Sun 25 Oct, 13:00 and no reply was added/)).toBeInTheDocument();
    expect(within(second).getByText("Nudge the customer")).toBeInTheDocument();
  });

  it("shows the countdown with words and an icon, the date under it, and the money in euros", async () => {
    panel(await sweepOf(cases()));
    const [first] = screen.getAllByTestId("today-item");
    expect(within(first).getByText("Claim deadline in 17 h")).toBeInTheDocument();
    expect(within(first).getByText("Thu 29 Oct, 04:00")).toBeInTheDocument();
    expect(within(first).getByTestId("today-amount")).toHaveTextContent("up to €25.00");
    const none = screen.getAllByTestId("today-item")[2];
    expect(within(none).getByText("No deadline ahead")).toBeInTheDocument();
    expect(within(none).queryByTestId("today-amount")).not.toBeInTheDocument();
  });

  it("follows the browser's clock for the countdown, a minute at a time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SWEEP_NOW.getTime() + 2 * 3_600_000));
    panel(await sweepOf([openCase("1004", { deadlineHours: 17 })]));
    // First render: the server's clock, so the page and the server agree.
    expect(screen.getByText("Claim deadline in 17 h")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Claim deadline in 14 h")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(15 * 3_600_000));
    expect(screen.getByText("Claim deadline passed")).toBeInTheDocument();
  });

  describe("a stored sweep read after a deadline passed (the cron runs once a day)", () => {
    const HOUR = 3_600_000;
    /** 1004 closes in 17 h and holds 25 EUR; 1005 closes in 60 h and holds 100 EUR. */
    const twoClaims = () => [
      openCase("1004", { deadlineHours: 17, eur: 25, carrier: "mondial_relay" }),
      openCase("1005", { deadlineHours: 60, eur: 100 }),
    ];

    it("takes the amount of an item whose deadline passed out of the item and out of the total", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(SWEEP_NOW);
      panel(await sweepOf(twoClaims()));
      const counts = screen.getByTestId("today-counts");
      expect(counts).toHaveTextContent("€125.00");
      expect(within(counts).getByText("Closing in 72 h").nextSibling).toHaveTextContent("2");
      expect(screen.queryByTestId("today-stale")).not.toBeInTheDocument();

      // 18 h later: 1004 closed 1 h ago, 1005 is still open.
      act(() => void vi.advanceTimersByTime(18 * HOUR));
      const [first, second] = screen.getAllByTestId("today-item");
      expect(within(first).getByText("Claim deadline passed")).toBeInTheDocument();
      expect(within(first).queryByTestId("today-amount")).not.toBeInTheDocument();
      const lost = within(first).getByTestId("today-amount-expired");
      expect(lost).toHaveTextContent("up to €25.00");
      expect(lost).toHaveTextContent("deadline passed, no longer claimable");
      expect(lost.querySelector("s")).not.toBeNull();
      expect(within(second).getByTestId("today-amount")).toHaveTextContent("up to €100.00");
      // The total no longer counts the lost 25 EUR; the closing-soon count no longer counts that item.
      expect(counts).toHaveTextContent("€100.00");
      expect(counts).not.toHaveTextContent("€125.00");
      expect(within(counts).getByText("Closing in 72 h").nextSibling).toHaveTextContent("1");
      // And the panel says the sweep is out of date, instead of presenting the paragraph as current.
      expect(screen.getByTestId("today-stale")).toHaveTextContent(/1 deadline has passed since this sweep ran/);

      act(() => void vi.advanceTimersByTime(45 * HOUR));
      expect(counts).toHaveTextContent("€0.00");
      expect(within(counts).getByText("Closing in 72 h").nextSibling).toHaveTextContent("0");
      expect(screen.getByTestId("today-stale")).toHaveTextContent(/2 deadlines have passed/);
    });

    it("counts an item that came inside the horizon since the sweep as closing soon", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(SWEEP_NOW);
      panel(await sweepOf([openCase("far", { deadlineHours: 80, eur: 10 })]));
      const counts = screen.getByTestId("today-counts");
      expect(within(counts).getByText("Closing in 72 h").nextSibling).toHaveTextContent("0");
      act(() => void vi.advanceTimersByTime(10 * HOUR));
      expect(within(counts).getByText("Closing in 72 h").nextSibling).toHaveTextContent("1");
    });

    it("keeps the amount when only a reserve window passed: the claim deadline is the amount's", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(SWEEP_NOW);
      const colis = openCase("colis", { deadlineHours: 4000, eur: 40 });
      const withReserve = { ...colis, claim: claimOf({ claimDeadline: at(4000), reserveDeadline: at(20), maxCompensationEur: 40 }) };
      panel(await sweepOf([withReserve]));
      act(() => void vi.advanceTimersByTime(21 * HOUR));
      const [item] = screen.getAllByTestId("today-item");
      expect(within(item).getByText("Reserve window passed")).toBeInTheDocument();
      expect(within(item).getByTestId("today-amount")).toHaveTextContent("up to €40.00");
      expect(screen.getByTestId("today-counts")).toHaveTextContent("€40.00");
    });

    it("never ticks a recorded run's amount against today's clock", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(SWEEP_NOW);
      const recorded: CaseRecord = {
        ...openCase("rec", { deadlineHours: 5 }),
        recorded: { recordedOn: "2026-10-27" },
        createdAt: "2026-10-27T16:00:00.000Z",
        claim: claimOf({ claimDeadline: "2026-10-29T10:00:00.000Z", maxCompensationEur: 25 }),
      };
      panel(await sweepOf([recorded], { includeRecorded: true }));
      act(() => void vi.advanceTimersByTime(100 * HOUR));
      expect(screen.getByTestId("today-amount")).toHaveTextContent("up to €25.00");
      expect(screen.queryByTestId("today-stale")).not.toBeInTheDocument();
    });

    it("takes the 'closing soon' threshold from the sweep, not from a number of its own", async () => {
      const sweep = { ...(await sweepOf([openCase("1004", { deadlineHours: 30 })])), horizonHours: 24 };
      panel(sweep);
      const pill = screen.getByText("Claim deadline in 1 d 6 h");
      expect(pill.className).not.toMatch(/warning/);
      expect(within(screen.getByTestId("today-counts")).getByText("Closing in 24 h").nextSibling).toHaveTextContent("0");
    });
  });

  it("shows the counts and the most that could still be claimed, without calling it a promise", async () => {
    panel(await sweepOf(cases()));
    const counts = screen.getByTestId("today-counts");
    expect(within(counts).getByText("Need you").nextSibling).toHaveTextContent("3");
    expect(within(counts).getByText("Closing in 72 h").nextSibling).toHaveTextContent("1");
    expect(within(counts).getByText("Customers not answering").nextSibling).toHaveTextContent("1");
    expect(counts).toHaveTextContent("€25.00");
    expect(counts).toHaveTextContent("At most, never a promise.");
  });

  it("says plainly when nothing is due", async () => {
    panel(await sweepOf([]));
    expect(screen.getByTestId("today-empty")).toHaveTextContent(/Nothing is due/);
    expect(screen.queryByRole("list", { name: "Today's plan" })).not.toBeInTheDocument();
  });

  it("says how many more cases the cap left out", async () => {
    const sweep = { ...(await sweepOf(cases())), moreItems: 4 };
    panel(sweep);
    expect(screen.getByText(/4 more cases are due/)).toBeInTheDocument();
  });

  it("marks a recorded run as recorded and does not tick its countdown against today's clock", async () => {
    const recorded: CaseRecord = {
      ...openCase("rec", { deadlineHours: 5 }),
      recorded: { recordedOn: "2026-10-27" },
      createdAt: "2026-10-27T16:00:00.000Z",
      claim: claimOf({ claimDeadline: "2026-10-29T10:00:00.000Z", maxCompensationEur: 25 }),
    };
    panel(await sweepOf([recorded], { includeRecorded: true }));
    expect(screen.getByText(/Rehearsal/)).toBeInTheDocument();
    const [item] = screen.getAllByTestId("today-item");
    expect(within(item).getByRole("img", { name: /Recorded run/ })).toBeInTheDocument();
    expect(within(item).getByText("Claim deadline in 1 d 18 h after the recording")).toBeInTheDocument();
  });

  it("labels a simulated reply's amount as not counted", async () => {
    const simulated = openCase("sim", { deadlineHours: 10, eur: 102.3 });
    simulated.followUps = [{ id: "f", receivedAt: NOW_ISO, message: "m", photos: [], simulated: true }];
    panel(await sweepOf([simulated]));
    expect(screen.getByText("Simulated reply: not counted")).toBeInTheDocument();
    expect(screen.getByTestId("today-counts")).toHaveTextContent("€0.00");
  });

  it("holds no customer name, e-mail, address or message", async () => {
    const { container } = panel(await sweepOf(cases()));
    expect(container.textContent).not.toMatch(/camille|laurent|example\.com|Lyon|arrived broken/i);
  });
});

describe("who wrote the text", () => {
  it("says DEMO MODE, in a note and under the paragraph, when a script wrote it", async () => {
    panel(await sweepOf(cases()));
    expect(screen.getByTestId("today-briefing-source")).toHaveTextContent("DEMO MODE: this paragraph comes from a script, not from Muse.");
    expect(screen.getByRole("note")).toHaveTextContent(/No model key is set here/);
    expect(screen.getAllByText(/DEMO MODE/).length).toBeGreaterThan(1);
  });

  it("says it fell back when the daily limit of real runs was reached", async () => {
    const sweep = { ...(await sweepOf(cases())), fellBackReason: "daily_limit" as const };
    panel(sweep);
    expect(screen.getByRole("note")).toHaveTextContent(/daily limit of real runs was reached/);
  });

  it("names the model when the model wrote it, and shows no DEMO MODE note", async () => {
    panel(await sweepOf(cases(), { provider: fakeMuse() }));
    expect(screen.getByTestId("today-briefing")).toHaveTextContent("Start with #1004. The rest can wait.");
    expect(screen.getByTestId("today-briefing-source")).toHaveTextContent("This paragraph was written by muse-spark-1.3.");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/DEMO MODE/)).not.toBeInTheDocument();
  });

  it("says a template stands in, and why, when the model's text was refused", async () => {
    panel(await sweepOf(cases(), { provider: fakeMuse({ briefing: "Claim 999 EUR now." }) }));
    expect(screen.getByTestId("today-briefing-source")).toHaveTextContent(/Template text, not the model's: the model's text stated a figure of its own/);
    expect(screen.getByTestId("today-briefing").textContent).not.toMatch(/999/);
  });
});

describe("the nudge draft", () => {
  it("is a draft to copy: the text, who wrote it, and a statement that nothing is sent", async () => {
    panel(await sweepOf(cases(), { provider: fakeMuse() }));
    const nudge = screen.getByTestId("today-nudge");
    expect(within(nudge).getByTestId("today-nudge-text")).toHaveTextContent("We are still waiting for sharper photos");
    expect(nudge).toHaveTextContent("This draft was written by muse-spark-1.3. Nothing is sent: copy it into your own mailbox.");
    expect(within(nudge).getByText(/Draft nudge for the customer \(English\)/)).toBeInTheDocument();
  });

  it("copies the text to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    panel(await sweepOf(cases(), { provider: fakeMuse() }));
    fireEvent.click(screen.getByRole("button", { name: "Copy the draft" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("sharper photos"));
  });

  it("has no send button anywhere", async () => {
    panel(await sweepOf(cases(), { provider: fakeMuse() }));
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
  });
});

describe("Run the sweep now", () => {
  it("is the empty state before the first sweep, with the button", () => {
    panel(null, { storageEphemeral: true });
    expect(screen.getByText(/No sweep has run yet/)).toBeInTheDocument();
    expect(screen.getByText(/may not be seen from here/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run the sweep now" })).toBeEnabled();
  });

  it("posts to /api/sweep and shows the new plan, the last run time and the engine", async () => {
    const next = await sweepOf(cases());
    const mock = fetchMock(() => ({ body: { sweep: next, stored: true } }));
    panel(null);
    fireEvent.click(screen.getByRole("button", { name: "Run the sweep now" }));
    await waitFor(() => expect(screen.getAllByTestId("today-item")).toHaveLength(3));
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("/api/sweep");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ includeRecorded: false });
    expect((init.headers as Record<string, string>)["x-access-code"]).toBeUndefined();
    expect(screen.getByTestId("today-last-run")).toHaveTextContent(/Last sweep 28 Oct 2026, 11:00 \(run on demand\)/);
  });

  it("asks for the recorded runs only when the box is ticked", async () => {
    const empty = await sweepOf([]);
    const mock = fetchMock(() => ({ body: { sweep: empty, stored: true } }));
    panel(null);
    fireEvent.click(screen.getByLabelText("Also read the recorded runs (rehearsal)"));
    fireEvent.click(screen.getByRole("button", { name: "Run the sweep now" }));
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(JSON.parse(mock.mock.calls[0][1].body as string)).toEqual({ includeRecorded: true });
  });

  it("needs the access code on a public deployment and does not call the server without it", async () => {
    const mock = fetchMock(() => ({ body: {} }));
    panel(null, { accessCodeRequired: true });
    fireEvent.click(screen.getByRole("button", { name: "Run the sweep now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Enter the access code/);
    expect(mock).not.toHaveBeenCalled();
  });

  it("sends the access code in the header and shows the server's refusal when it is wrong", async () => {
    const mock = fetchMock(() => ({ status: 401, body: { error: "access_code_required", message: "That access code is not correct. Running the sweep needs it." } }));
    panel(await sweepOf(cases()), { accessCodeRequired: true });
    fireEvent.change(screen.getByLabelText("Access code"), { target: { value: " wrong-code " } });
    fireEvent.click(screen.getByRole("button", { name: "Run the sweep now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That access code is not correct.");
    expect((mock.mock.calls[0][1].headers as Record<string, string>)["x-access-code"]).toBe("wrong-code");
    // The plan that was on screen stays.
    expect(screen.getAllByTestId("today-item")).toHaveLength(3);
  });

  it("says so when the sweep ran but could not be stored", async () => {
    const unstored = await sweepOf(cases());
    fetchMock(() => ({ body: { sweep: unstored, stored: false } }));
    panel(null);
    fireEvent.click(screen.getByRole("button", { name: "Run the sweep now" }));
    await waitFor(() => expect(screen.getByText(/could not be stored/)).toBeInTheDocument());
  });

  it("says so when the server cannot be reached, and changes nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    panel(await sweepOf(cases()));
    fireEvent.click(screen.getByRole("button", { name: "Run the sweep now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not reach the server/);
    expect(screen.getAllByTestId("today-item")).toHaveLength(3);
  });

  it("does not start a second run while one is going", async () => {
    let release: (r: Response) => void = () => {};
    const mock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal("fetch", mock);
    panel(null);
    const button = screen.getByRole("button", { name: "Run the sweep now" });
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Running the sweep…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Running the sweep…" }));
    expect(mock).toHaveBeenCalledTimes(1);
    release(new Response(JSON.stringify({ sweep: await sweepOf([]), stored: true }), { status: 200 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run the sweep now" })).toBeEnabled());
  });
});

describe("what a screen reader hears", () => {
  it("announces the end of a run with what it found, and moves focus to the new paragraph", async () => {
    const next = await sweepOf(cases());
    fetchMock(() => ({ body: { sweep: next, stored: true } }));
    panel(null);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("");
    fireEvent.click(screen.getByRole("button", { name: "Run the sweep now" }));
    await waitFor(() =>
      expect(status).toHaveTextContent("Sweep done: 3 cases need you, 1 close within 72 h, texts written by the DEMO MODE script."),
    );
    await waitFor(() => expect(screen.getByTestId("today-briefing")).toHaveFocus());
  });

  it("says when nothing is due, and when the result was not saved", async () => {
    fetchMock(() => ({ body: { sweep: emptySweep, stored: false } }));
    panel(null);
    fireEvent.click(screen.getByRole("button", { name: "Run the sweep now" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sweep done: nothing is due, texts written by the DEMO MODE script. The result was not saved."));
  });
});

describe("approved cases whose claim is not marked as filed", () => {
  const approved = () => ({ ...openCase("ap", { deadlineHours: 200, eur: 52.9 }), status: "approved" as const });

  it("offers 'mark as filed', which only notes it, and then says so", async () => {
    const mock = fetchMock(() => ({ body: { case: {} } }));
    panel(await sweepOf([approved()]), { accessCodeRequired: false });
    expect(screen.getByText("File the claim")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /I filed it: mark as filed/ }));
    await screen.findByText(/Marked as filed: it leaves the plan at the next sweep/);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("/api/cases/ap");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ claimFiled: true });
  });

  it("lets the merchant undo a mistaken click: Undo sends claimFiled false and brings the button back", async () => {
    const mock = fetchMock(() => ({ body: { case: {} } }));
    panel(await sweepOf([approved()]));
    fireEvent.click(screen.getByRole("button", { name: /I filed it: mark as filed/ }));
    await screen.findByText(/Marked as filed: it leaves the plan at the next sweep/);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: /I filed it: mark as filed/ })).toBeInTheDocument();
    expect(screen.queryByText(/Marked as filed/)).not.toBeInTheDocument();
    expect(mock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mock.mock.calls[1][1].body as string)).toEqual({ claimFiled: false });
    expect(mock.mock.calls[1][1].method).toBe("PATCH");
  });

  it("keeps the filed note when the undo fails, and says why", async () => {
    let calls = 0;
    fetchMock(() => (++calls === 1 ? { body: { case: {} } } : { status: 500, body: { message: "The store is down." } }));
    panel(await sweepOf([approved()]));
    fireEvent.click(screen.getByRole("button", { name: /mark as filed/ }));
    await screen.findByText(/Marked as filed/);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The store is down.");
    expect(screen.getByText(/Marked as filed/)).toBeInTheDocument();
  });

  it("shows the server's reason when the note cannot be saved", async () => {
    fetchMock(() => ({ status: 409, body: { message: "Only an approved case with an eligible claim can be marked as filed." } }));
    panel(await sweepOf([approved()]));
    fireEvent.click(screen.getByRole("button", { name: /mark as filed/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Only an approved case/);
    expect(screen.queryByText(/Marked as filed/)).not.toBeInTheDocument();
  });

  it("offers it on no other kind of case", async () => {
    panel(await sweepOf(cases()));
    expect(screen.queryByRole("button", { name: /mark as filed/ })).not.toBeInTheDocument();
  });
});

describe("on the Cases page", () => {
  it("sits under the hero band and above the Insights, and is absent without `today`", async () => {
    const live = [makeCase({ id: "c1" })];
    const { container, rerender } = render(
      <CasesDashboard cases={live} error={null} now={SWEEP_NOW} today={{ sweep: await sweepOf(cases()), accessCodeRequired: false, storageEphemeral: false }} />,
    );
    const html = container.innerHTML;
    expect(html.indexOf('id="today-title"')).toBeGreaterThan(html.indexOf('id="cases-title"'));
    expect(html.indexOf('id="today-title"')).toBeLessThan(html.indexOf('id="insights-title"'));
    rerender(<CasesDashboard cases={live} error={null} now={SWEEP_NOW} />);
    expect(screen.queryByTestId("today-panel")).not.toBeInTheDocument();
  });
});
