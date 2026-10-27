// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MeasuredTime } from "@/lib/impact/measured-time";
import { FIELDS } from "@/lib/impact/roi";
import { RoiCalculator } from "./roi-calculator";
import { SourcesSection } from "./sources-section";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/impact" }));

const MEASURED: MeasuredTime = {
  runs: [
    { id: "a", orderId: "#1001", seconds: 32.1, decision: "reship" },
    { id: "b", orderId: "#1002", seconds: 18.6, decision: "no_action" },
    { id: "c", orderId: "#1003", seconds: 40, decision: null },
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
    expect(text("roi-summary")).toContain("€2,415.84");
    expect(text("roi-summary")).toContain("€1,391.04");
    expect(text("roi-damaged")).toBe("96");
    expect(text("roi-goods")).toBe("€5,760");
    expect(text("roi-available")).toBe("up to €2,415.84");
    expect(text("roi-gain")).toBe("+€1,024.80");
    expect(text("roi-bar-hand")).toContain("up to €1,391.04");
    expect(text("roi-bar-hand")).toContain("Lost to deadlines: €1,024.80");
    expect(text("roi-bar-gilmend")).toContain("Lost to deadlines: €0");
  });

  it("recomputes as soon as a number changes", () => {
    render(<RoiCalculator measured={MEASURED} />);
    type("Claim filed by hand after the report", "0");
    expect(text("roi-gain")).toBe("+€0");
    expect(text("roi-bar-hand")).toContain("Lost to deadlines: €0");
    type("Orders per month", "800");
    expect(text("roi-damaged")).toBe("192");
    expect(text("roi-available")).toBe("up to €4,831.68");
  });

  it("says in the table why a carrier is lost: its window closes before a manual claim", () => {
    render(<RoiCalculator measured={MEASURED} />);
    const mr = screen.getByTestId("roi-carrier-mondial_relay");
    expect(mr).toHaveTextContent("Closes 72 h after delivery. Filed at 120 h by hand, 36 h with Gilmend.");
    expect(mr).toHaveTextContent("The window closes before the claim is filed by hand");
    expect(mr).toHaveTextContent("€420");
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

describe("Sources section", () => {
  it("lists the measured runs with their time and the summary the calculator uses", () => {
    render(<SourcesSection measured={MEASURED} />);
    const table = screen.getByRole("table", { name: "Duration of each recorded run" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("32.1 s")).toBeInTheDocument();
    expect(within(table).getByText("No decision")).toBeInTheDocument();
    expect(text("measured-summary")).toContain("Mean 30.2 s, median 32.1 s, from 18.6 s to 40.0 s, over 3 real runs");
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
    expect(screen.getByTestId("rules-colissimo")).toHaveTextContent("€23 per kg, capped at €690");
    expect(screen.getByTestId("rules-colissimo")).toHaveTextContent("72 h reserve window (prudential)");
    // How sure we are of each figure is kept, not rounded up to a flat claim.
    expect(screen.getByTestId("rules-colissimo")).toHaveTextContent(/dated source/);
    expect(screen.getByTestId("rules-colissimo")).toHaveTextContent(/unverified/);
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
