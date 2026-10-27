// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotFound from "@/app/not-found";
import { AppHeader } from "../app-header";
import { CasesDashboard } from "../cases-dashboard";
import { NOW, makeCase } from "../fixtures";
import { StatusPill } from "../status-pill";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => pathname.value,
}));

afterEach(() => {
  pathname.value = "/";
  vi.unstubAllEnvs();
});

const rowFor = (id: string) =>
  within(screen.getByRole("list", { name: "Cases" }))
    .getAllByRole("listitem")
    .find((r) => r.querySelector(`a[href="/cases/${id}"]`))!;

function threeCases() {
  const base = makeCase();
  return [
    makeCase({ id: "c-review" }),
    makeCase({ id: "c-approved", status: "approved", report: { ...base.report, orderNumber: "#1002" }, order: { ...base.order!, id: "#1002" } }),
    makeCase({ id: "c-rejected", status: "rejected", report: { ...base.report, orderNumber: "#1003" }, order: { ...base.order!, id: "#1003" } }),
  ];
}

describe("App header", () => {
  it("shows the logo, the nav with the current page marked, the engine and the primary action", () => {
    vi.stubEnv("MODEL_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    render(<AppHeader />);
    expect(screen.getByRole("link", { name: "Gilmend, all cases" })).toHaveAttribute("href", "/");
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Cases" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Report a damaged parcel" })).toHaveAttribute("href", "/report");
    // Without a key the chip says so in full, in the header, on every screen.
    expect(screen.getByText(/DEMO MODE/).textContent).toMatch(/not Muse/);
  });

  it("steps the primary action aside on the report screen, where the form has its own", () => {
    pathname.value = "/report";
    render(<AppHeader />);
    expect(screen.queryByRole("link", { name: "Report a damaged parcel" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "New report" })).toHaveAttribute("aria-current", "page");
  });
});

describe("Cases list: filter", () => {
  it("narrows the list to a status, announces it, and can be reset", () => {
    render(<CasesDashboard cases={threeCases()} error={null} now={NOW} />);
    expect(within(screen.getByRole("list", { name: "Cases" })).getAllByRole("listitem")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /^Approved/ }));
    const rows = within(screen.getByRole("list", { name: "Cases" })).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("#1002")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3 cases");

    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(within(screen.getByRole("list", { name: "Cases" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("says so when no case has the chosen status, and offers the whole list back", () => {
    render(<CasesDashboard cases={[makeCase({ id: "a" }), makeCase({ id: "b" })]} error={null} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: /^Closed/ }));
    expect(screen.queryByRole("list", { name: "Cases" })).not.toBeInTheDocument();
    expect(screen.getByText("No case matches this filter.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all cases" }));
    expect(screen.getByRole("list", { name: "Cases" })).toBeInTheDocument();
  });

  it("has no filter for a single case", () => {
    render(<CasesDashboard cases={[makeCase()]} error={null} now={NOW} />);
    expect(screen.queryByRole("group", { name: "Filter cases by status" })).not.toBeInTheDocument();
  });
});

describe("Cases list: rows", () => {
  it("names each row's link after the item and the order, not after the whole row", () => {
    render(<CasesDashboard cases={[makeCase()]} error={null} now={NOW} />);
    expect(screen.getByRole("link", { name: "Ceramic vase #1001 · Camille Laurent" })).toHaveAttribute("href", "/cases/case-1");
  });

  it("says a missed deadline in words as well as tone", () => {
    const base = makeCase();
    const late = makeCase({ id: "late", claim: { ...base.claim!, claimDeadline: "2026-10-20T16:00:00.000Z" } });
    render(<CasesDashboard cases={[late]} error={null} now={NOW} />);
    expect(within(rowFor("late")).getByText("Overdue")).toBeInTheDocument();
  });

  it("keeps the 'Up to' wording: the amount is a maximum, not a promise", () => {
    render(<CasesDashboard cases={[makeCase()]} error={null} now={NOW} />);
    expect(within(rowFor("case-1")).getByText("Up to")).toBeInTheDocument();
  });
});

describe("Cases hero: honesty notes stay visible", () => {
  it("flags demo-mode cases that are counted in the figure", () => {
    render(<CasesDashboard cases={[makeCase({ engine: "demo-mock" })]} error={null} now={NOW} />);
    expect(screen.getByTestId("demo-mode-note")).toHaveTextContent("Includes 1 demo-mode case: scripted decisions, not Muse.");
  });

  it("says nothing about demo mode when no counted case comes from it", () => {
    render(<CasesDashboard cases={[makeCase()]} error={null} now={NOW} />);
    expect(screen.queryByTestId("demo-mode-note")).not.toBeInTheDocument();
  });

  it("labels the recorded-runs figure and says it is not in the live total", () => {
    const rec = makeCase({ id: "rec", recorded: { recordedOn: "2026-10-27" }, createdAt: "2026-10-27T15:05:53.148Z" });
    render(<CasesDashboard cases={[rec]} error={null} now={NOW} />);
    // The visible tile (aria-hidden, animated digits) names the figure; the note below says what it is.
    expect(screen.getByText("Recorded runs")).toBeInTheDocument();
    expect(screen.getByText("1 real Muse run, as of 27 Oct 2026.")).toBeInTheDocument();
    expect(screen.getByTestId("recorded-note")).toHaveTextContent("not counted in the live counter");
  });
});

describe("Status pill", () => {
  it.each([
    ["new", "New"],
    ["needs_review", "Needs review"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
    ["sent_to_customer", "Sent to customer"],
  ] as const)("says %s in words, with an icon", (status, label) => {
    const { container } = render(<StatusPill status={status} />);
    const pill = container.querySelector(`[data-status="${status}"]`)!;
    expect(pill).toHaveTextContent(label);
    expect(pill.querySelector("svg")).not.toBeNull();
  });
});

describe("Not found", () => {
  it("explains and leads back to the cases", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Case not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to cases" })).toHaveAttribute("href", "/");
  });
});
