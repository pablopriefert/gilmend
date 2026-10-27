// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NOW, makeCase } from "../fixtures";
import { CaseView } from "../case-view";
import type { PhotoIntegrity } from "@/lib/types";
import { IntegrityRow } from "./integrity-row";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/cases/case-1",
}));

const HASH = { dhash: "0123456789abcdef", ahash: "fedcba9876543210" };

function integrity(over: Partial<PhotoIntegrity> = {}): PhotoIntegrity {
  return {
    checkedAt: "2026-10-28T07:00:05.000Z",
    calledBy: "model",
    photos: [{ index: 0, hash: HASH, hasExif: false, capturedAt: null, matches: [] }],
    comparedCases: 4,
    comparedPhotos: 5,
    comparedDemoPhotos: 6,
    deliveredAt: "2026-10-27T16:00:00.000Z",
    signals: [],
    notes: [],
    ...over,
  };
}

describe("IntegrityRow: a clean result", () => {
  it("says what was compared, that nothing matched, and that a missing capture date is not a signal", () => {
    render(<IntegrityRow integrity={integrity()} />);
    const row = screen.getByTestId("integrity");
    expect(within(row).getByText("Integrity")).toBeInTheDocument();
    expect(within(row).getByText("No signal")).toBeInTheDocument();
    expect(row).toHaveTextContent("Compared with 5 photos from 4 earlier cases and 6 demo photos.");
    expect(row).toHaveTextContent("Photo 1: no match.");
    expect(row).toHaveTextContent("no capture date in the file. Most apps strip it, so this is not a signal.");
    expect(row).toHaveTextContent("Delivery: 27 Oct 2026, 16:00 UTC.");
    expect(row).toHaveTextContent("Called by the agent");
    expect(row).not.toHaveTextContent(/signals?: a person must look/);
  });

  it("keeps the honest limits in view: perceptual hashes, a clean result proves nothing, a signal is no verdict", () => {
    render(<IntegrityRow integrity={integrity()} />);
    const row = screen.getByTestId("integrity");
    expect(row).toHaveTextContent(/catches the same file after a resize or a re-save, not a crop, a mirror image, an edit or a photo of a screen/);
    expect(row).toHaveTextContent(/A clean result does not prove the photos are genuine/);
    expect(row).toHaveTextContent(/a signal is a reason to look, not a verdict on the customer/);
    expect(row).toHaveTextContent(/Cases filed before this check existed hold no hash and cannot be compared/);
  });

  it("says when the code ran the check because the model had not", () => {
    render(<IntegrityRow integrity={integrity({ calledBy: "code" })} />);
    expect(screen.getByTestId("integrity")).toHaveTextContent("Run by the code (the model had not called it)");
  });

  it("does not claim a comparison when there was nothing to compare with", () => {
    render(<IntegrityRow integrity={integrity({ comparedCases: 0, comparedPhotos: 0, comparedDemoPhotos: 0 })} />);
    expect(screen.getByTestId("integrity")).toHaveTextContent("Compared with nothing: no earlier case with a hash, and no demo photo.");
  });

  it("uses the singular for a single photo and a single case", () => {
    render(<IntegrityRow integrity={integrity({ comparedCases: 1, comparedPhotos: 1, comparedDemoPhotos: 1 })} />);
    expect(screen.getByTestId("integrity")).toHaveTextContent("Compared with 1 photo from 1 earlier case and 1 demo photo.");
  });
});

describe("IntegrityRow: signals", () => {
  const flagged = integrity({
    photos: [
      {
        index: 0,
        hash: HASH,
        hasExif: true,
        capturedAt: "2026-10-10T09:30:00",
        matches: [
          { source: "case", caseId: "case_abc", sameOrderAndCustomer: false, dhashDistance: 3, ahashDistance: 5 },
        ],
      },
    ],
    signals: [
      { kind: "reused_photo", photoIndex: 0, message: "Photo 1 looks like a photo already filed in 1 other case for a different order or customer." },
      { kind: "captured_before_delivery", photoIndex: 0, message: "Photo 1 says it was taken on 2026-10-10 09:30, 17 days before the parcel was delivered (2026-10-27 16:00 UTC)." },
    ],
  });

  it("lists each signal, with a count and a person-must-look pill (icon and words, not colour alone)", () => {
    render(<IntegrityRow integrity={flagged} />);
    const row = screen.getByTestId("integrity");
    expect(within(row).getByText("2 signals: a person must look")).toBeInTheDocument();
    const list = within(row).getByRole("list", { name: "Integrity signals" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(list).toHaveTextContent("Photo 1 looks like a photo already filed in 1 other case");
    expect(list).toHaveTextContent("17 days before the parcel was delivered");
  });

  it("links the other case and shows the capture date as written, with the hash distances", () => {
    render(<IntegrityRow integrity={flagged} />);
    const row = screen.getByTestId("integrity");
    expect(within(row).getByRole("link", { name: "Open case …_abc" })).toHaveAttribute("href", "/cases/case_abc");
    expect(row).toHaveTextContent("A different order or customer");
    expect(row).toHaveTextContent("hash distance 3/64 and 5/64");
    expect(row).toHaveTextContent("taken 10 Oct 2026, 09:30 (as written in the file, no time zone)");
  });

  it("says 1 signal in the singular", () => {
    render(<IntegrityRow integrity={integrity({ signals: [flagged.signals[0]] })} />);
    expect(screen.getByText("1 signal: a person must look")).toBeInTheDocument();
  });

  it("describes a demo photo without a link, and a re-filed report as expected", () => {
    render(
      <IntegrityRow
        integrity={integrity({
          photos: [
            {
              index: 0,
              hash: HASH,
              hasExif: false,
              capturedAt: null,
              matches: [
                { source: "demo", caseId: "demo-1-vase-broken", sameOrderAndCustomer: true, dhashDistance: 0, ahashDistance: 1 },
                { source: "case", caseId: "case_same", sameOrderAndCustomer: true, dhashDistance: 1, ahashDistance: 2 },
              ],
            },
          ],
        })}
      />,
    );
    const row = screen.getByTestId("integrity");
    expect(row).toHaveTextContent("Its own demo photo (reuse by design)");
    expect(row).toHaveTextContent("Same order and customer: a report filed again");
    expect(within(row).getAllByRole("link")).toHaveLength(1);
  });

  it("names the demo case when a demo photo was filed for another order", () => {
    render(
      <IntegrityRow
        integrity={integrity({
          photos: [
            {
              index: 0,
              hash: HASH,
              hasExif: false,
              capturedAt: null,
              matches: [{ source: "demo", caseId: "demo-1-vase-broken", sameOrderAndCustomer: false, dhashDistance: 0, ahashDistance: 0 }],
            },
          ],
          signals: [{ kind: "demo_photo_reused", photoIndex: 0, message: "Photo 1 is one of the demo photos shipped with Gilmend, filed for an order and customer that are not its demo case." }],
        })}
      />,
    );
    expect(screen.getByTestId("integrity")).toHaveTextContent("The demo photo of demo case demo-1-vase-broken, filed for another order or customer");
  });

  it("says a photo was not read instead of reporting 'no match'", () => {
    render(
      <IntegrityRow
        integrity={integrity({
          photos: [{ index: 0, hash: null, unreadable: "the file could not be decoded as an image", hasExif: false, capturedAt: null, matches: [] }],
          notes: ["Photo 1 could not be read or decoded, so it was neither hashed nor compared."],
        })}
      />,
    );
    const row = screen.getByTestId("integrity");
    expect(row).toHaveTextContent("Photo 1: not hashed, so not compared (the file could not be decoded as an image).");
    expect(row).toHaveTextContent("Photo 1: not read.");
    expect(row).not.toHaveTextContent("Photo 1: no match.");
    expect(row).toHaveTextContent("Photo 1 could not be read or decoded");
  });

  it("says the delivery date is unknown when there is none to compare with", () => {
    render(<IntegrityRow integrity={integrity({ deliveredAt: null })} />);
    expect(screen.getByTestId("integrity")).toHaveTextContent("Delivery: unknown (no order, or not delivered yet).");
  });
});

describe("IntegrityRow: no result", () => {
  it.each([
    ["recorded", /recorded run was made before the integrity check existed.*cannot be compared/],
    ["unfinished", /has not reached it/],
    ["absent", /filed before the check existed, or the agent stopped before it/],
  ] as const)("says why a case is not checked (%s) and does not pretend it is clean", (missing, text) => {
    render(<IntegrityRow integrity={undefined} missing={missing} />);
    const row = screen.getByTestId("integrity");
    expect(within(row).getByText("Not checked")).toBeInTheDocument();
    expect(row).toHaveTextContent(text);
    expect(within(row).queryByText("No signal")).not.toBeInTheDocument();
  });
});

describe("the case page", () => {
  it("shows the Integrity row under the photos, and a warning at the top when there is a signal", () => {
    const c = makeCase({
      integrity: integrity({
        signals: [{ kind: "reused_photo", photoIndex: 0, message: "Photo 1 looks like a photo already filed in 1 other case for a different order or customer." }],
      }),
    });
    render(<CaseView caseRecord={c} rules={null} now={NOW} />);
    const evidence = screen.getByRole("region", { name: "Customer report and evidence" });
    expect(within(evidence).getByTestId("integrity")).toBeInTheDocument();
    const note = screen.getByTestId("integrity-note");
    expect(note).toHaveTextContent("Photo integrity: 1 signal.");
    expect(note).toHaveTextContent("A person must check the photos before anything is filed or sent");
    expect(note).toHaveTextContent("not a verdict on the customer");
  });

  it("shows no warning at the top when the check found nothing", () => {
    render(<CaseView caseRecord={makeCase({ integrity: integrity() })} rules={null} now={NOW} />);
    expect(screen.queryByTestId("integrity-note")).not.toBeInTheDocument();
    expect(screen.getByTestId("integrity")).toHaveTextContent("No signal");
  });

  it("says 'not checked' on an older case, and on a recorded run it says the run predates the check", () => {
    const { rerender } = render(<CaseView caseRecord={makeCase()} rules={null} now={NOW} />);
    expect(screen.getByTestId("integrity")).toHaveTextContent(/filed before the check existed/);
    rerender(<CaseView caseRecord={makeCase({ recorded: { recordedOn: "2026-10-27" } })} rules={null} now={NOW} />);
    expect(screen.getByTestId("integrity")).toHaveTextContent(/recorded run was made before the integrity check existed/);
  });

  it("says the check has not run yet on a case the agent has not finished", () => {
    render(<CaseView caseRecord={makeCase({ status: "new", decision: null })} rules={null} now={NOW} />);
    expect(screen.getByTestId("integrity")).toHaveTextContent(/has not reached it/);
  });
});

describe("IntegrityRow: several matches, a uniform photo", () => {
  const match = (caseId: string) => ({
    source: "case" as const,
    caseId,
    sameOrderAndCustomer: false,
    dhashDistance: 1,
    ahashDistance: 2,
  });

  it("gives every link to another case its own name, so a screen reader can tell them apart", () => {
    const photo = { index: 0, hash: HASH, hasExif: false, capturedAt: null, matches: [match("case_aaaa1111"), match("case_bbbb2222")] };
    render(<IntegrityRow integrity={integrity({ photos: [photo] })} />);
    const links = within(screen.getByTestId("integrity")).getAllByRole("link");
    const names = links.map((l) => l.getAttribute("aria-label"));
    expect(names).toEqual(["Open case …1111", "Open case …2222"]);
    expect(new Set(names).size).toBe(names.length);
    // The visible text is part of the accessible name (WCAG 2.5.3).
    links.forEach((l) => expect(l.getAttribute("aria-label")).toContain(l.textContent));
  });

  it("says how many more matches are not listed", () => {
    const photo = {
      index: 0,
      hash: HASH,
      hasExif: false,
      capturedAt: null,
      matches: ["a", "b", "c", "d", "e"].map((x) => match(`case_${x}000`)),
      matchCount: 20,
      otherMatchCount: 20,
    };
    render(<IntegrityRow integrity={integrity({ photos: [photo] })} />);
    expect(screen.getByTestId("integrity")).toHaveTextContent("and 15 more matches, not listed (the 5 closest are shown).");
  });

  it("says a uniform photo was not compared, instead of 'no match'", () => {
    const photo = { index: 0, hash: HASH, uniform: true, hasExif: false, capturedAt: null, matches: [] };
    render(<IntegrityRow integrity={integrity({ photos: [photo] })} />);
    const row = screen.getByTestId("integrity");
    expect(row).toHaveTextContent("Photo 1: too uniform (dark, blank or over-exposed) to compare.");
    expect(row).not.toHaveTextContent("Photo 1: no match.");
  });
});
