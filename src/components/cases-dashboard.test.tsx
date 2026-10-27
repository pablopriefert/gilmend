// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CasesDashboard } from "./cases-dashboard";
import { NOW, makeCase } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));

describe("Cases dashboard", () => {
  it("shows the counter, and a row per case with status, carrier, amount, deadline and engine", () => {
    const base = makeCase();
    const rejected = makeCase({
      id: "case-2",
      status: "rejected",
      engine: "demo-mock",
      report: { ...base.report, orderNumber: "#1002" },
      order: { ...base.order!, id: "#1002", name: "Hugo Bernard", carrier: "mondial_relay" },
      decision: { ...base.decision!, carrierClaim: false },
    });
    render(<CasesDashboard cases={[base, rejected]} error={null} now={NOW} />);

    // Rejected and no-claim cases are left out of the money. Cents are kept: a rounded total
    // over- or under-states what can be claimed.
    expect(screen.getByTestId("counter").textContent).toBe("€55.20 recoverable this month · 1 claim due this week");
    expect(screen.getByText(/Not a promise of payment/)).toBeInTheDocument();

    const rows = within(screen.getByRole("list", { name: "Cases" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    const first = within(rows[0]);
    expect(first.getByRole("link")).toHaveAttribute("href", "/cases/case-1");
    expect(first.getByText("#1001")).toBeInTheDocument();
    expect(first.getByText("Needs review")).toBeInTheDocument();
    expect(first.getByText("Colissimo")).toBeInTheDocument();
    expect(first.getByText("€55.20")).toBeInTheDocument();
    expect(first.getByText("6 days left")).toBeInTheDocument();
    expect(first.getByText("Muse Spark 1.3")).toBeInTheDocument();

    const second = within(rows[1]);
    expect(second.getByText("Rejected")).toBeInTheDocument();
    expect(second.getByText("Mondial Relay")).toBeInTheDocument();
    expect(second.getByText("No claim")).toBeInTheDocument();
    // The compact badge still tells screen readers it is the mock, not Muse.
    expect(second.getByLabelText("DEMO MODE: deterministic mock, not Muse")).toHaveTextContent("DEMO MODE");
  });

  it("invites the user to report a parcel when there are no cases", () => {
    render(<CasesDashboard cases={[]} error={null} now={NOW} />);
    expect(screen.getByRole("heading", { name: "No cases yet" })).toBeInTheDocument();
    expect(screen.getByTestId("counter").textContent).toMatch(/^€0 recoverable this month · 0 claims due this week$/);
    expect(screen.getAllByRole("link", { name: "Report a damaged parcel" }).length).toBeGreaterThan(0);
  });

  it("says so when the store cannot be read instead of showing an empty list", () => {
    render(<CasesDashboard cases={[]} error="Cases could not be loaded." now={NOW} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Cases could not be loaded.");
    expect(screen.queryByText("No cases yet")).not.toBeInTheDocument();
  });

  it("marks a case the customer replied to with its round, and no other", () => {
    const followed = makeCase({
      id: "case-2",
      followUps: [{ id: "fu", receivedAt: "2026-10-28T09:00:00.000Z", message: "Sharper photo.", photos: [] }],
    });
    render(<CasesDashboard cases={[makeCase(), followed]} error={null} now={NOW} />);
    const rows = within(screen.getByRole("list", { name: "Cases" })).getAllByRole("listitem");
    expect(within(rows[0]).queryByText(/^Round \d/)).not.toBeInTheDocument();
    expect(within(rows[1]).getByText("Round 2")).toBeInTheDocument();
  });
});
