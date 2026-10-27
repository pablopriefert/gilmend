// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CaseView } from "./case-view";
import { CasesDashboard } from "./cases-dashboard";
import { NOW, makeCase, makeRules } from "./fixtures";
import { caseClock } from "./format";
import { photoSrc } from "./photo-src";
import { RecordedBadge } from "./recorded-badge";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

// A recording of 27 Oct 2026 looked at on 4 Nov: its claim deadline (30 Oct) is long past.
const LATER = new Date("2026-11-04T09:00:00.000Z");
const recorded = () =>
  makeCase({
    id: "real_demo-1-vase-broken",
    createdAt: "2026-10-27T15:05:53.148Z",
    recorded: { recordedOn: "2026-10-27" },
    claim: { ...makeCase().claim!, claimDeadline: "2026-10-30T16:00:00.000Z" },
  });

describe("recorded runs in the UI", () => {
  it("the badge says what it is, with the recording date", () => {
    render(<RecordedBadge recorded={{ recordedOn: "2026-10-27" }} />);
    expect(screen.getByText("Recorded run · 27 Oct 2026")).toBeInTheDocument();
    render(<RecordedBadge recorded={{ recordedOn: "2026-10-27" }} compact />);
    expect(screen.getByLabelText(/Recorded run: a real Muse Spark 1\.3 run, recorded on 27 Oct 2026/)).toHaveTextContent("Recorded");
  });

  it("the list marks a recorded run, and reads its deadline as of the recording, not as overdue", () => {
    render(<CasesDashboard cases={[recorded(), makeCase({ id: "mine", createdAt: "2026-11-03T09:00:00.000Z" })]} error={null} now={LATER} />);
    const rows = within(screen.getByRole("list", { name: "Cases" })).getAllByRole("listitem");
    const recordedRow = rows.find((r) => r.querySelector('a[href="/cases/real_demo-1-vase-broken"]'))!;
    expect(within(recordedRow).getByLabelText(/^Recorded run/)).toBeInTheDocument();
    // 3 days left on 27 Oct 2026 (the deadline is 30 Oct, 16:00): the snapshot, not "Overdue".
    expect(within(recordedRow).getByText(/days? left/)).toBeInTheDocument();
    expect(within(recordedRow).queryByText("Overdue")).not.toBeInTheDocument();
    const own = rows.find((r) => r.querySelector('a[href="/cases/mine"]'))!;
    expect(within(own).queryByLabelText(/^Recorded run/)).not.toBeInTheDocument();
  });

  it("the header says recorded runs are listed but not counted", () => {
    render(<CasesDashboard cases={[recorded(), { ...recorded(), id: "second" }]} error={null} now={NOW} />);
    expect(screen.getByTestId("recorded-note")).toHaveTextContent("2 recorded runs (real Muse runs saved with the code) are listed below but not counted.");
    expect(screen.getByTestId("counter").textContent).toBe("€0 recoverable this month · 0 claims due this week");
  });

  it("the header says nothing about recorded runs when there are none", () => {
    render(<CasesDashboard cases={[makeCase()]} error={null} now={NOW} />);
    expect(screen.queryByTestId("recorded-note")).not.toBeInTheDocument();
  });

  it("the case page explains the recording and keeps the actions available", () => {
    render(<CaseView caseRecord={recorded()} rules={makeRules()} now={LATER} />);
    expect(screen.getByTestId("recorded-note")).toHaveTextContent(/real run of Muse Spark 1\.3 and SAM 3\.1 on the Meta Model API, recorded on 27 Oct 2026/);
    expect(screen.getByTestId("recorded-note")).toHaveTextContent(
      "The customer photos were generated with Meta's Muse Image for this demo (data/photos/README.md); Muse Spark and SAM ran on exactly these images.",
    );
    expect(screen.getByTestId("recorded-note")).toHaveTextContent(/read-only: approving, editing or rejecting it stores a copy/);
    expect(screen.getByText("Recorded run · 27 Oct 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    // Not the DEMO MODE banner: it is a real run.
    expect(screen.queryByText(/Demo mode\./)).not.toBeInTheDocument();
  });

  it("a normal case has no recording banner", () => {
    render(<CaseView caseRecord={makeCase()} rules={makeRules()} now={NOW} />);
    expect(screen.queryByTestId("recorded-note")).not.toBeInTheDocument();
  });

  it("caseClock freezes a recorded run at its creation and leaves other cases on the real clock", () => {
    expect(caseClock(recorded(), LATER).toISOString()).toBe("2026-10-27T15:05:53.148Z");
    expect(caseClock(makeCase(), LATER)).toBe(LATER);
  });

  it("photoSrc serves a showcase file through /api/files under the virtual showcase/ folder", () => {
    expect(photoSrc("data/showcase/evidence/9c95-annotated.jpg")).toBe("/api/files?p=showcase%2Fevidence%2F9c95-annotated.jpg");
    expect(photoSrc("data/showcase/photos/vase-broken.webp")).toBe("/api/files?p=showcase%2Fphotos%2Fvase-broken.webp");
  });
});
