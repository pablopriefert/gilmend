// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeasuredTime } from "@/lib/impact/measured-time";
import { FIELDS } from "@/lib/impact/roi";
import { RoiCalculator } from "./roi-calculator";
import { SourcesSection } from "./sources-section";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/impact" }));

const MEASURED: MeasuredTime = {
  runs: [
    { id: "a", orderId: "#1001", seconds: 32.1, decision: "reship", withSam: true },
    { id: "b", orderId: "#1002", seconds: 18.6, decision: "no_action", withSam: true },
    { id: "c", orderId: "#1003", seconds: 40, decision: null, withSam: false },
  ],
  meanSeconds: 30.2,
  medianSeconds: 32.1,
  minSeconds: 18.6,
  maxSeconds: 40,
  recordedOn: "2026-10-27",
};

const field = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
const text = (id: string) => screen.getByTestId(id).textContent ?? "";
/** A stat is a label, a figure and a note in one block: the test id sits on the figure. */
const block = (id: string) => screen.getByTestId(id).parentElement?.textContent ?? "";

describe("ROI calculator: inputs", () => {
  it("shows every input with its label, its unit and whether it is your figure or an assumption", () => {
    render(<RoiCalculator measured={MEASURED} />);
    const form = screen.getByRole("form", { name: "Your numbers" });
    expect(within(form).getAllByRole("textbox")).toHaveLength(FIELDS.length);
    const assumptions = FIELDS.filter((f) => f.kind === "assumption").length;
    expect(within(form).getAllByText("Assumption")).toHaveLength(assumptions);
    expect(within(form).getAllByText("Your figure")).toHaveLength(FIELDS.length - assumptions);
    // The damage rate is the number most likely to be mistaken for a statistic.
    const rate = field("Damage rate");
    expect(rate).toHaveAccessibleDescription(/^Assumption, not a measured rate/);
    expect(rate.closest("div")?.parentElement).toHaveTextContent("Assumption");
  });

  it("groups the inputs in labelled fieldsets", () => {
    render(<RoiCalculator measured={MEASURED} />);
    for (const name of ["Your shop", "Carrier mix", "How claims go", "Time per case"]) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
  });
});

describe("ROI calculator: results", () => {
  it("works the example numbers through, in a sentence and in figures", () => {
    render(<RoiCalculator measured={MEASURED} />);
    expect(text("roi-summary")).toContain("96 damaged parcels a year");
    expect(text("roi-summary")).toContain("€2,079.84");
    expect(text("roi-summary")).toContain("€1,391.04");
    expect(text("roi-damaged")).toBe("96");
    expect(text("roi-goods")).toBe("€5,760");
    expect(text("roi-available")).toBe("up to €2,079.84");
    expect(text("roi-gain")).toBe("+€688.80");
    expect(text("roi-bar-hand")).toContain("up to €1,391.04");
    expect(text("roi-bar-hand")).toContain("Lost to deadlines: €688.80");
    expect(text("roi-bar-gilmend")).toContain("Lost to deadlines: €0");
  });

  it("recomputes as soon as a number changes", () => {
    render(<RoiCalculator measured={MEASURED} />);
    type("Claim filed by hand after the report", "0");
    expect(text("roi-gain")).toBe("+€0");
    expect(text("roi-bar-hand")).toContain("Lost to deadlines: €0");
    type("Orders per month", "800");
    expect(text("roi-damaged")).toBe("192");
    expect(text("roi-available")).toBe("up to €4,159.68");
  });

  it("says in the table why a carrier is lost: its window closes before a manual claim", () => {
    render(<RoiCalculator measured={MEASURED} />);
    const mr = screen.getByTestId("roi-carrier-mondial_relay");
    expect(mr).toHaveTextContent("Closes 72 h after delivery. Filed at 120 h by hand, 36 h with Gilmend.");
    expect(mr).toHaveTextContent("The window closes before the claim is filed by hand");
    expect(mr).toHaveTextContent("Pays only the 20% of parcels refused at delivery.");
    // One claim a refused parcel is paid: the full 25 EUR; the year counts 20% of them (16.8 claims x 25 x 20%).
    expect(mr).toHaveTextContent("€25");
    expect(mr).toHaveTextContent("€84");
    const colissimo = screen.getByTestId("roi-carrier-colissimo");
    expect(colissimo).toHaveTextContent("The short reserve window only warns.");
    expect(colissimo).not.toHaveTextContent("before the claim is filed");
  });

  it("tells a customer who writes in too late from a merchant who files too late", () => {
    render(<RoiCalculator measured={MEASURED} />);
    type("Customer reports the damage after", "100");
    expect(screen.getByTestId("roi-carrier-mondial_relay")).toHaveTextContent("The customer reports after the window: nothing to claim");
    expect(screen.getByTestId("roi-carrier-mondial_relay")).not.toHaveTextContent("filed by hand");
  });

  it("owns up when the inputs make Gilmend recover less than a fast manual process", () => {
    render(<RoiCalculator measured={MEASURED} />);
    type("Claim filed by hand after the report", "0");
    type("Claim filed with Gilmend after the report", "200");
    expect(text("roi-gain")).toMatch(/^−€/);
    expect(screen.getByTestId("roi-gain").parentElement).toHaveTextContent("Less recovered with Gilmend");
  });

  it("rescales carrier shares and says so, instead of refusing 105%", () => {
    render(<RoiCalculator measured={MEASURED} />);
    expect(text("roi-share-total")).toBe("Total: 100%.");
    type("Colissimo", "65");
    expect(text("roi-share-total")).toBe("Total entered: 105%, rescaled to 100%.");
    expect(screen.getByTestId("roi-carrier-colissimo")).toHaveTextContent("62%");
  });
});

describe("ROI calculator: time", () => {
  it("puts the measured agent time and the assumed review time side by side", () => {
    render(<RoiCalculator measured={MEASURED} />);
    const t = block("roi-time-gilmend");
    expect(t).toContain("3.5 min");
    expect(t).toContain("Agent 30 s, measured on 3 recorded runs");
    expect(t).toContain("your 3 min (assumption)");
    expect(block("roi-time-hand")).toContain("20 min");
    expect(block("roi-time-hand")).toContain("Your assumption");
    // 20 min by hand, minus 30.2 s of agent and 3 min of review: 16.5 min, shown as a whole number from 10 up.
    expect(block("roi-time-saved")).toContain("16 min");
    expect(text("roi-time-year")).toContain("saved a year, over 96 damaged parcels");
  });

  it("does not invent an agent time when no run was measured", () => {
    render(<RoiCalculator measured={null} />);
    const t = block("roi-time-gilmend");
    expect(t).toContain("3 min");
    expect(t).toContain("not measured here");
    expect(t).not.toContain("measured on");
  });
});

describe("ROI calculator: a time that is not saved", () => {
  it("says it is extra time, with the absolute value and a sentence, instead of a minus sign", () => {
    render(<RoiCalculator measured={MEASURED} />);
    type("Time per case by hand", "2");
    type("Your review time per case with Gilmend", "5");
    const saved = block("roi-time-saved");
    expect(saved).toContain("Extra time per case with Gilmend");
    expect(saved).not.toContain("Saved per case");
    // 2 min by hand against 30.2 s of agent plus 5 min of review: 3.5 min more, shown without a sign.
    expect(text("roi-time-saved")).toBe("3.5 min");
    expect(saved).toContain("Gilmend does not save time");
    expect(text("roi-time-year")).toBe("5.6 h more a year, over 96 damaged parcels.");
    expect(document.body.textContent).not.toMatch(/-\d+(\.\d)? (min|h)\b/);
  });
});

describe("ROI calculator: bad input", () => {
  it("names the bad field, hides the results, and brings them back when it is fixed", () => {
    render(<RoiCalculator measured={MEASURED} />);
    type("Damage rate", "abc");
    expect(field("Damage rate")).toHaveAttribute("aria-invalid", "true");
    expect(field("Damage rate")).toHaveAccessibleDescription(/Enter a plain number/);
    expect(screen.getByTestId("roi-invalid")).toHaveTextContent("One number is not valid");
    expect(screen.queryByTestId("roi-summary")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Per carrier" })).not.toBeInTheDocument();
    type("Damage rate", "3");
    expect(field("Damage rate")).not.toHaveAttribute("aria-invalid");
    expect(text("roi-damaged")).toBe("144");
  });

  it("points at the form, not 'on the left' (a phone shows the results first), and names each bad field", () => {
    render(<RoiCalculator measured={MEASURED} />);
    type("Damage rate", "abc");
    type("Parcel weight", "0");
    const box = screen.getByTestId("roi-invalid");
    expect(box).toHaveTextContent("in the form");
    expect(box).not.toHaveTextContent("on the left");
    const buttons = within(within(box).getByRole("list", { name: "Fields to fix" })).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Damage rate", "Parcel weight"]);
    fireEvent.click(buttons[1]);
    expect(field("Parcel weight")).toHaveFocus();
  });

  it("does not shout on every keystroke: no assertive alert from the box, the per-field error is a polite status", () => {
    render(<RoiCalculator measured={MEASURED} />);
    type("Orders per month", "");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("roi-invalid")).not.toHaveAttribute("role");
    expect(screen.getByText("Enter a number.").closest("[role]")).toHaveAttribute("role", "status");
  });

  it("counts several bad fields and refuses an empty one", () => {
    render(<RoiCalculator measured={MEASURED} />);
    type("Orders per month", "");
    type("Parcel weight", "0");
    expect(screen.getByTestId("roi-invalid")).toHaveTextContent("2 numbers are not valid");
    expect(field("Orders per month")).toHaveAccessibleDescription(/Enter a number/);
    expect(field("Parcel weight")).toHaveAccessibleDescription(/Must be at least 0.05/);
  });

  it("resets to the examples", () => {
    render(<RoiCalculator measured={MEASURED} />);
    const reset = screen.getByRole("button", { name: "Reset to the examples" });
    expect(reset).toBeDisabled();
    type("Damage rate", "7");
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(field("Damage rate").value).toBe("2");
    expect(reset).toBeDisabled();
    expect(text("roi-damaged")).toBe("96");
  });
});

describe("ROI calculator: announcements", () => {
  afterEach(() => vi.useRealTimers());

  it("announces a short summary once the person stops typing, not on every keystroke, and keeps the long summary silent", () => {
    vi.useFakeTimers();
    render(<RoiCalculator measured={MEASURED} />);
    const live = screen.getByTestId("roi-announcement");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveTextContent("up to €2,079.84 a year recovered with Gilmend, up to €1,391.04 by hand");
    expect(screen.getByTestId("roi-summary")).not.toHaveAttribute("aria-live");
    type("Orders per month", "8");
    type("Orders per month", "80");
    type("Orders per month", "800");
    // Still the old text: nothing was announced during the typing.
    expect(live).toHaveTextContent("€2,079.84 a year");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(live).toHaveTextContent("up to €4,159.68 a year recovered with Gilmend");
    type("Orders per month", "");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(live).toHaveTextContent("1 number is not valid.");
  });
});

describe("Sources section", () => {
  it("lists the measured runs with their time and the summary the calculator uses", () => {
    render(<SourcesSection measured={MEASURED} />);
    const table = screen.getByRole("table", { name: "Duration of each recorded run" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("32.1 s")).toBeInTheDocument();
    expect(within(table).getByText("No decision")).toBeInTheDocument();
    expect(text("measured-summary")).toContain("Mean 30.2 s, median 32.1 s, from 18.6 s to 40.0 s, over 3 real runs");
    // Two of the three drew a SAM outline: the summary says so instead of crediting SAM to every run.
    expect(text("measured-summary")).toContain("of Muse Spark 1.3, 2 of them with a SAM 3.1 outline");
    expect(screen.getByText(/the SAM outline when one was drawn/)).toBeInTheDocument();
    expect(within(table).getAllByText("Yes")).toHaveLength(2);
    expect(within(table).getAllByText("No")).toHaveLength(1);
    // Each run links back to its case.
    expect(within(table).getByRole("link", { name: "#1001" })).toHaveAttribute("href", "/cases/a");
    expect(screen.getByText(/What this is not: a benchmark/)).toBeInTheDocument();
  });

  it("says no run was found rather than showing an empty table", () => {
    render(<SourcesSection measured={null} />);
    expect(screen.getByTestId("measured-none")).toHaveTextContent("not measured");
    expect(screen.queryByRole("table", { name: "Duration of each recorded run" })).not.toBeInTheDocument();
  });

  it("reads the carrier terms from the rules: what each pays and when its window closes", () => {
    render(<SourcesSection measured={null} />);
    expect(screen.getByTestId("rules-mondial_relay")).toHaveTextContent("€25 per parcel, capped at €25");
    expect(screen.getByTestId("rules-mondial_relay")).toHaveTextContent("3 days after delivery");
    // Colissimo's terms say after shipment; the app counts from the order date only as the safe side.
    expect(screen.getByTestId("rules-colissimo")).toHaveTextContent("365 days after shipment (counted from the order date, the safe side)");
    expect(screen.getByTestId("rules-colissimo")).toHaveTextContent("€23 per kg, capped at €690");
    expect(screen.getByTestId("rules-colissimo")).toHaveTextContent("72 h reserve window (prudential)");
    // How sure we are of each figure is kept, not rounded up to a flat claim.
    expect(screen.getByTestId("rules-colissimo")).toHaveTextContent(/dated source/);
    expect(screen.getByTestId("rules-colissimo")).toHaveTextContent(/unverified/);
  });

  it("lists the German carriers too: DHL Paket and GLS, with their amounts, windows and the official pages they were read on", () => {
    render(<SourcesSection measured={null} />);
    const dhl = screen.getByTestId("rules-dhl_paket");
    expect(dhl).toHaveTextContent("DHL Paket");
    expect(dhl).toHaveTextContent("€500 per parcel, capped at €500");
    expect(dhl).toHaveTextContent("7 days after delivery");
    expect(dhl).toHaveTextContent("168 h reserve window");
    expect(dhl).not.toHaveTextContent("prudential"); // DHL says damage must be reported within the 7 days
    expect(within(dhl).getByRole("link", { name: /DHL Paket\/Express National general terms/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/www\.dhl\.de\/dam\//),
    );
    const gls = screen.getByTestId("rules-gls");
    expect(gls).toHaveTextContent("GLS");
    expect(gls).toHaveTextContent("€750 per parcel, capped at €750");
    expect(gls).toHaveTextContent("365 days after delivery");
    expect(gls).toHaveTextContent("168 h reserve window (prudential)");
    // The statutory basis of the GLS windows is one of the two links shown, not hidden behind a third.
    expect(within(gls).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      expect.stringMatching(/gls-pakete\.de\/downloads\/AGB_GLS_Germany/),
      "https://www.gesetze-im-internet.de/hgb/__438.html",
    ]);
    // Every German figure was read in an official text: all verified, nothing to warn about.
    expect(dhl).toHaveTextContent(/4 verified/);
    expect(gls).toHaveTextContent(/4 verified/);
    expect(gls).not.toHaveTextContent(/unverified/);
  });

  it("cites the public study with its address, its date and what it is not", () => {
    render(<SourcesSection measured={null} />);
    const source = screen.getByTestId("source-ds-smith-opinium-2026");
    const link = within(source).getByRole("link", { name: /Les colis endommagés/ });
    expect(link).toHaveAttribute("href", expect.stringMatching(/^https:\/\/www\.ecommercemag\.fr\//));
    expect(link).toHaveAttribute("lang", "fr");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(source).toHaveTextContent("7 Jan 2026");
    expect(source).toHaveTextContent("22% of French consumers");
    expect(source).toHaveTextContent("no per-parcel damage rate");
  });

  it("lists every assumption by name", () => {
    render(<SourcesSection measured={null} />);
    const list = within(screen.getByTestId("assumed-list")).getAllByRole("listitem");
    expect(list.map((li) => li.textContent)).toEqual(FIELDS.filter((f) => f.kind === "assumption").map((f) => f.label));
  });
});
