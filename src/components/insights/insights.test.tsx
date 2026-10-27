// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildInsights } from "@/lib/impact/insights";
import { summarizeRecordedRuns } from "@/lib/store/summary";
import type { CarrierId, CaseRecord, DecisionKind } from "@/lib/types";
import { CasesDashboard } from "../cases-dashboard";
import { makeCase, NOW } from "../fixtures";
import { InsightsSection } from "./insights-section";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));

const HOUR = 3_600_000;
const at = (base: number, h: number) => new Date(base + h * HOUR).toISOString();

function claimCase(
  id: string,
  carrier: CarrierId,
  eur: number,
  claimHours: number,
  opts: { recorded?: boolean; decision?: DecisionKind; reserveHours?: number; engine?: CaseRecord["engine"] } = {},
): CaseRecord {
  const base = makeCase();
  // A recorded run is read as of its createdAt, five days before NOW.
  const readAtMs = opts.recorded ? NOW.getTime() - 5 * 24 * HOUR : NOW.getTime();
  return makeCase({
    id,
    createdAt: new Date(readAtMs).toISOString(),
    engine: opts.engine ?? "muse-spark-1.3",
    order: { ...base.order!, id: `#${id}`, carrier },
    claim: {
      eligible: true,
      reasons: [],
      maxCompensationEur: eur,
      claimDeadline: at(readAtMs, claimHours),
      reserveDeadline: at(readAtMs, opts.reserveHours ?? claimHours),
      daysLeft: Math.floor(claimHours / 24),
    },
    decision: { ...base.decision!, decision: opts.decision ?? "reship", carrierClaim: true },
    ...(opts.recorded ? { recorded: { recordedOn: "2026-10-23" } } : {}),
  });
}

function section(cases: CaseRecord[]) {
  const recorded = summarizeRecordedRuns(cases);
  return (
    <InsightsSection
      live={buildInsights(cases, NOW, { includeRecorded: false })}
      withRecorded={buildInsights(cases, NOW, { includeRecorded: true })}
      recordedCount={recorded.count}
      recordedAsOf={recorded.asOf}
    />
  );
}

const live = () => [
  claimCase("mr", "mondial_relay", 25, 30),
  claimCase("ch", "chronopost", 120, 60, { decision: "refund" }),
  claimCase("co", "colissimo", 34.5, 24 * 300, { reserveHours: 50 }),
];
const recorded = () => [claimCase("rec", "chronopost", 250, 52, { recorded: true, decision: "ask_more_photos" })];

describe("Insights: per carrier", () => {
  it("shows the money and the claims of each carrier, short windows first, and the total", () => {
    render(section(live()));
    const rows = screen.getAllByTestId(/^carrier-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["carrier-mondial_relay", "carrier-chronopost", "carrier-colissimo"]);
    expect(within(rows[0]).getByText("€25")).toBeInTheDocument();
    expect(within(rows[1]).getByText("€120")).toBeInTheDocument();
    expect(within(rows[2]).getByText("€34.50")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Claim window: 3 days after delivery")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Claim window: 365 days after shipment (counted from the order date, the safe side)")).toBeInTheDocument();
    expect(screen.getByTestId("insights-total")).toHaveTextContent("€179.50");
  });

  it("says 'No open claim' for a carrier with nothing, without a zero euro that looks like a result", () => {
    render(section([claimCase("mr", "mondial_relay", 25, 30)]));
    expect(within(screen.getByTestId("carrier-colissimo")).getByText("No open claim")).toBeInTheDocument();
  });

  it("sets 'No open claim' in the muted ink: gold is for money", () => {
    render(section([claimCase("mr", "mondial_relay", 25, 30)]));
    const none = within(screen.getByTestId("carrier-colissimo")).getByText("No open claim");
    expect(none).toHaveClass("text-muted");
    expect(none).not.toHaveClass("text-gold-ink");
  });

  it("says in one sentence that no claim is open, instead of three empty gold tracks and a 0 EUR total", () => {
    // Recorded runs only, with the switch turned off: the live view has no case at all.
    render(section(recorded()));
    fireEvent.click(screen.getByRole("switch", { name: "Include recorded runs" }));
    expect(screen.getByTestId("carriers-empty")).toHaveTextContent("No claim open.");
    expect(screen.queryByTestId("insights-total")).not.toBeInTheDocument();
    expect(screen.queryByTestId("carrier-mondial_relay")).not.toBeInTheDocument();
  });

  it("says its scope: every open claim of any month, while the counter above counts this month", () => {
    render(section(live()));
    expect(screen.getByRole("region", { name: "Money still claimable, by carrier" })).toHaveTextContent(
      "every open claim of any month (the counter above counts this month only)",
    );
  });

  it("draws the money bars in gold and hides them from assistive technology: the rows say it all", () => {
    render(section(live()));
    const bar = screen.getByTestId("carrier-chronopost").querySelector("[aria-hidden='true']");
    expect(bar).not.toBeNull();
    expect(bar?.innerHTML).toContain("bg-gold");
  });
});

describe("Insights: decisions", () => {
  it("counts each decision with its share, and says how many went to a human", () => {
    render(section(live()));
    expect(within(screen.getByTestId("decision-reship")).getByText("2")).toBeInTheDocument();
    expect(within(screen.getByTestId("decision-refund")).getByText(/33%/)).toBeInTheDocument();
    expect(within(screen.getByTestId("decision-no_action")).getByText("0")).toBeInTheDocument();
    expect(screen.getByText(/3 cases with a decision/)).toBeInTheDocument();
  });

  it("draws those bars in ink, never gold: gold is for money", () => {
    render(section(live()));
    const bar = screen.getByTestId("decision-reship").querySelector("[aria-hidden='true']");
    expect(bar?.innerHTML).toContain("bg-ink");
    expect(bar?.innerHTML).not.toContain("gold");
  });
});

describe("Insights: deadline timeline", () => {
  it("lists every window as text, soonest first, with the case, the carrier, the time left and the money", () => {
    render(section(live()));
    const list = screen.getByRole("list", { name: /Windows closing in the next 14 days, soonest first/ });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("data-testid"))).toEqual([
      "deadline-mr-claim",
      "deadline-co-reserve",
      "deadline-ch-claim",
    ]);
    expect(items[0]).toHaveTextContent("#mr");
    expect(items[0]).toHaveTextContent("Mondial Relay");
    expect(items[0]).toHaveTextContent("Last day to file the claim");
    expect(items[0]).toHaveTextContent("in 1 d 6 h, under 3 days");
    expect(items[0]).toHaveTextContent("€25");
    expect(within(items[0]).getByRole("link", { name: "#mr" })).toHaveAttribute("href", "/cases/mr");
  });

  it("names a prudential reserve window as such, without any money on it", () => {
    render(section(live()));
    const reserve = screen.getByTestId("deadline-co-reserve");
    expect(reserve).toHaveTextContent("prudential: a later report only adds a warning");
    expect(reserve).not.toHaveTextContent("€");
  });

  it("draws the strips for the eye only: the list carries the same events as text", () => {
    render(section(live()));
    const chart = screen.getByTestId("timeline-chart");
    expect(chart).toHaveAttribute("aria-hidden", "true");
    expect(chart).toHaveTextContent("Now");
    expect(chart).toHaveTextContent("14 d");
  });

  it("labels day 0 'Recording' when every event is a recorded run, and never paints one as urgent", () => {
    render(section(recorded()));
    const chart = screen.getByTestId("timeline-chart");
    expect(chart).toHaveTextContent("Recording");
    expect(chart).not.toHaveTextContent("Now");
    const event = screen.getByTestId("deadline-rec-claim");
    // 52 h after its recording would be "under 3 days" for a live case.
    expect(event).toHaveTextContent("2 d 4 h after the recording");
    expect(event).not.toHaveTextContent("under 3 days");
    expect(event.querySelector(".text-warning")).toBeNull();
    expect(event.querySelector(".border-warning")).toBeNull();
    expect(screen.queryByRole("list", { name: "Legend" })).not.toHaveTextContent("from now");
  });

  it("keeps 'Now' and the urgent styling for live events when recorded runs are mixed in, and the recorded ones stay hollow and calm", () => {
    render(section([...live(), ...recorded()]));
    fireEvent.click(screen.getByRole("switch", { name: "Include recorded runs" }));
    expect(screen.getByTestId("timeline-chart")).toHaveTextContent("Now");
    expect(screen.getByTestId("deadline-mr-claim")).toHaveTextContent("under 3 days");
    expect(screen.getByTestId("deadline-rec-claim")).not.toHaveTextContent("under 3 days");
    expect(screen.getByRole("list", { name: "Legend" })).toHaveTextContent("Under 3 days from now");
  });

  it("says when nothing closes in the next 14 days, and points at the claims that close later", () => {
    render(section([claimCase("far", "colissimo", 50, 24 * 100, { reserveHours: 24 * 100 })]));
    expect(screen.getByTestId("timeline-empty")).toHaveTextContent("No claim or reserve window closes in the next 14 days.");
    expect(screen.getByTestId("timeline-later")).toHaveTextContent(/1 more claim closes after 14 days/);
    expect(screen.getByTestId("timeline-later")).toHaveTextContent("€50");
  });
});

describe("Insights: the recorded-runs toggle", () => {
  it("starts on live cases only when there are some, and says what is left out", () => {
    render(section([...live(), ...recorded()]));
    const toggle = screen.getByRole("switch", { name: "Include recorded runs" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId("insights-counting")).toHaveTextContent("Counting 3 live cases.");
    expect(screen.getByTestId("insights-counting")).toHaveTextContent("1 real Muse run recorded on 23 Oct 2026 is left out.");
    expect(screen.getByTestId("insights-total")).toHaveTextContent("€179.50");
  });

  it("counts the recorded runs on request, with their money and a note on how they are read", () => {
    render(section([...live(), ...recorded()]));
    fireEvent.click(screen.getByRole("switch", { name: "Include recorded runs" }));
    expect(screen.getByRole("switch", { name: "Include recorded runs" })).toBeChecked();
    expect(screen.getByTestId("insights-counting")).toHaveTextContent("Counting 3 live cases and 1 recorded run.");
    expect(screen.getByTestId("insights-total")).toHaveTextContent("€429.50");
    expect(screen.getByTestId("insights-recorded-note")).toHaveTextContent(/read as of their recording day/);
    // The recorded run is on the timeline, counted from its recording and marked as such.
    expect(screen.getByTestId("deadline-rec-claim")).toHaveTextContent("2 d 4 h after the recording");
    expect(screen.getByTestId("deadline-rec-claim")).toHaveTextContent("Recorded run of 23 Oct 2026");
    fireEvent.click(screen.getByRole("switch", { name: "Include recorded runs" }));
    expect(screen.queryByTestId("deadline-rec-claim")).not.toBeInTheDocument();
    expect(screen.getByTestId("insights-total")).toHaveTextContent("€179.50");
  });

  it("starts on, and says so, when a fresh deployment has only the recorded runs: it must not open on empty charts", () => {
    render(section(recorded()));
    expect(screen.getByRole("switch", { name: "Include recorded runs" })).toBeChecked();
    expect(screen.getByTestId("insights-counting")).toHaveTextContent("Counting 0 live cases and 1 recorded run.");
    expect(screen.getByTestId("insights-total")).toHaveTextContent("€250");
  });

  it("offers no toggle when there is no recorded run", () => {
    render(section(live()));
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByTestId("insights-recorded-note")).not.toBeInTheDocument();
  });

  it("keeps saying demo-mode cases are scripted, not Muse", () => {
    render(section([claimCase("mock", "colissimo", 20, 100, { engine: "demo-mock" })]));
    expect(screen.getByTestId("insights-demo-note")).toHaveTextContent("Includes 1 demo-mode case: scripted decisions, not Muse.");
  });
});

describe("Cases dashboard with the Insights band", () => {
  const heading = () => screen.queryByRole("heading", { name: "Where the money is, and when it runs out" });

  it("puts the insights under the hero and above the list", () => {
    render(<CasesDashboard cases={live()} error={null} now={NOW} />);
    const order = [
      screen.getByRole("heading", { name: "Cases" }),
      heading()!,
      screen.getByRole("heading", { name: "Money still claimable, by carrier" }),
      screen.getByRole("list", { name: "Cases" }),
    ];
    for (let i = 0; i < order.length - 1; i++) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("is absent for an empty inbox and for an unreadable store, so zeros never pass for data", () => {
    const { unmount } = render(<CasesDashboard cases={[]} error={null} now={NOW} />);
    expect(heading()).not.toBeInTheDocument();
    unmount();
    render(<CasesDashboard cases={live()} error="Cases could not be loaded." now={NOW} />);
    expect(heading()).not.toBeInTheDocument();
  });

  it("leaves the hero counters live-only whatever the toggle says", () => {
    render(<CasesDashboard cases={[...live(), ...recorded()]} error={null} now={NOW} />);
    const before = screen.getByTestId("counter").textContent;
    fireEvent.click(screen.getByRole("switch", { name: "Include recorded runs" }));
    expect(screen.getByTestId("counter").textContent).toBe(before);
  });
});
