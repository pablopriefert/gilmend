// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEventInput, StreamEvent } from "@/lib/agent/events";
import { ReportForm } from "./report-form";

// The report page with a streamed answer (27 Oct 2026): a mocked fetch hands back an NDJSON body
// that the test feeds line by line, so what is on screen after each line is what a person would see.

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => "/report" }));

const MUSE = { museKey: true, openWeights: false };
const NONE = { museKey: false, openWeights: false };

const image = () => new File([new Uint8Array(2000)], "vase.jpg", { type: "image/jpeg" });

function send(availability = MUSE, props: { demoPaceMs?: number } = { demoPaceMs: 0 }) {
  render(<ReportForm availability={availability} {...props} />);
  fireEvent.change(screen.getByLabelText("Order number"), { target: { value: "#1001" } });
  fireEvent.change(screen.getByLabelText("E-mail used for the order"), { target: { value: "camille@example.com" } });
  fireEvent.change(screen.getByLabelText("Message from the customer"), { target: { value: "My vase arrived broken" } });
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [image()] } });
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));
}

/** A streamed answer the test controls: `line(event)` sends one NDJSON line, `end()` closes the body. */
function liveResponse(init: { status?: number; contentType?: string } = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const res = new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "application/x-ndjson; charset=utf-8" },
  });
  return {
    res,
    line: (e: StreamEvent) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`)),
    raw: (s: string) => controller.enqueue(enc.encode(s)),
    end: () => controller.close(),
  };
}

const accepted = (engine: "muse-spark-1.3" | "demo-mock" = "muse-spark-1.3"): StreamEvent => ({
  type: "accepted",
  t: 0,
  caseId: "case_abc",
  engine,
  requestedEngine: "muse-spark-1.3",
  fellBack: false,
  fellBackReason: null,
});
const ev = (e: AgentEventInput & { t?: number }): StreamEvent => ({ t: 1, ...e }) as StreamEvent;
const done = (engine: "muse-spark-1.3" | "demo-mock" = "muse-spark-1.3", t = 41_200): StreamEvent => ({
  type: "done",
  t,
  caseId: "case_abc",
  status: "needs_review",
  engine,
  requestedEngine: "muse-spark-1.3",
  fellBack: false,
  fellBackReason: null,
});

const ORDER = {
  orderId: "#1001",
  carrier: "colissimo" as const,
  service: "Colissimo Domicile sans signature",
  items: ["Ceramic vase"],
  deliveredAt: "2026-10-25T14:00:00.000Z",
  total: 59,
  currency: "EUR",
};

beforeEach(() => {
  push.mockReset();
  let n = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:photo-${n++}`, revokeObjectURL: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe("the live timeline on the report page", () => {
  it("asks for the stream, and draws each step as its line arrives, with the server's timing", async () => {
    const stream = liveResponse();
    const fetchMock = vi.fn(async () => stream.res);
    vi.stubGlobal("fetch", fetchMock);
    send();

    await screen.findByTestId("live-run");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Accept).toMatch(/application\/x-ndjson/);

    await act(async () => {
      stream.line(accepted());
      stream.line(ev({ type: "run_started", engine: "muse-spark-1.3", model: "muse-spark", label: "Muse Spark 1.3 (Meta Model API)", mock: false, photos: 1 }));
      stream.line(ev({ type: "thinking", t: 20, turn: 1, phase: "start" }));
    });
    const panel = screen.getByTestId("live-run");
    expect(await within(panel).findByText("Muse is reading the report and the photos")).toBeInTheDocument();
    expect(within(panel).getByText("Report received and stored")).toBeInTheDocument();
    // Nothing that has not happened yet: no order, no claim.
    expect(within(panel).queryByLabelText("Order found")).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText("Claim")).not.toBeInTheDocument();
    expect(within(panel).getByRole("list", { name: /live/ }).querySelector('[aria-current="step"]')).toHaveTextContent(/Muse is reading/);

    await act(async () => {
      stream.line(ev({ type: "thinking", t: 4100, turn: 1, phase: "end", ok: true, toolCalls: 1, ms: 4080 }));
      stream.line(ev({ type: "tool_start", t: 4200, tool: "get_order", turn: 1, calledBy: "model" }));
      stream.line(
        ev({ type: "tool_end", t: 4350, tool: "get_order", turn: 1, calledBy: "model", ok: true, ms: 150, result: { tool: "get_order", found: true, order: ORDER } }),
      );
    });
    const card = await within(panel).findByLabelText("Order found");
    expect(card).toHaveTextContent("#1001");
    expect(card).toHaveTextContent("Colissimo, Colissimo Domicile sans signature");
    expect(card).toHaveTextContent("Ceramic vase");
    // The row carries the server's clock (+4.2 s: when the step began), not the time the browser heard of it.
    const row = panel.querySelector('[data-step="get_order"]')!;
    expect(row).toHaveTextContent("Looking up the order");
    expect(row).toHaveTextContent("+4.2 s");
    expect(row).toHaveTextContent("Order #1001 found, shipped by Colissimo.");
    expect(within(panel).getByText("Muse read the report and the photos")).toBeInTheDocument();
    // The customer's e-mail never appears on the timeline.
    expect(panel).not.toHaveTextContent("camille@example.com");
    stream.end();
  });

  it("fades in the SAM image once it is stored, counts the claim up in gold, and shows guardrails", async () => {
    const stream = liveResponse();
    vi.stubGlobal("fetch", vi.fn(async () => stream.res));
    send();
    await screen.findByTestId("live-run");
    await act(async () => {
      stream.line(accepted());
      stream.line(ev({ type: "tool_start", t: 9000, tool: "mark_damage", turn: 2, calledBy: "model" }));
    });
    const panel = screen.getByTestId("live-run");
    expect(await within(panel).findByText("Outlining with SAM 3.1")).toBeInTheDocument();
    expect(within(panel).queryByRole("img")).not.toBeInTheDocument();

    await act(async () => {
      stream.line(
        ev({
          type: "tool_end",
          t: 14_200,
          tool: "mark_damage",
          turn: 2,
          calledBy: "model",
          ok: true,
          ms: 5200,
          result: { tool: "mark_damage", photoIndex: 0, concepts: ["broken pottery"], method: "sam-3.1", regions: 3, annotatedPath: "data/runtime/evidence/abc-annotated.jpg", note: "n" },
        }),
      );
    });
    const img = await within(panel).findByRole("img", { name: "Photo 1 outlined by SAM 3.1" });
    expect(img).toHaveAttribute("src", "/api/files?p=evidence%2Fabc-annotated.jpg");
    expect(panel).toHaveTextContent("3 regions outlined on photo 1 for “broken pottery”");
    expect(panel).toHaveTextContent(/not the damage itself/);
    // The row says when the step began (+9.0 s) and how long it took (5.2 s).
    expect(panel.querySelector('[data-step="mark_damage"]')).toHaveTextContent("+9.0 s · 5.2 s");

    await act(async () => {
      stream.line(
        ev({
          type: "tool_end",
          t: 21_000,
          tool: "compute_claim",
          turn: 3,
          calledBy: "model",
          ok: true,
          ms: 3,
          result: { tool: "compute_claim", eligible: true, maxCompensationEur: 32.2, claimDeadline: "2026-11-15T12:00:00.000Z", daysLeft: 19 },
        }),
      );
      stream.line(ev({ type: "guardrail", t: 30_000, message: "needsHuman forced: the confidence is below 0.7" }));
    });
    const claim = await within(panel).findByLabelText("Claim");
    // The figure is read by assistive tech as plain text, and it is the code's number.
    await waitFor(() => expect(claim).toHaveTextContent("€32.20"));
    expect(claim).toHaveTextContent("Maximum compensation");
    expect(claim).toHaveTextContent("Claim by 15 Nov 2026 · 19 days left");
    expect(claim).toHaveTextContent(/Worked out by code/);
    const guardrail = panel.querySelector('[data-step="guardrail"]')!;
    expect(guardrail).toHaveTextContent("needsHuman forced: the confidence is below 0.7");
    stream.end();
  });

  it("ends on 'Open the case', saved and reachable, and opens it on a click", async () => {
    const stream = liveResponse();
    vi.stubGlobal("fetch", vi.fn(async () => stream.res));
    send();
    await screen.findByTestId("live-run");
    await act(async () => {
      stream.line(accepted());
      stream.line(ev({ type: "run_finished", t: 41_000, reachedDecision: true, decision: "reship", confidence: 0.9, needsHuman: false, carrierClaim: true, ms: 41_000 }));
      stream.line(done());
      stream.end();
    });
    const panel = screen.getByTestId("live-run");
    expect(await within(panel).findByRole("heading", { name: "The case is ready" })).toBeInTheDocument();
    expect(panel).toHaveTextContent("Reship");
    expect(panel).toHaveTextContent("Confidence 90%");
    const open = within(panel).getByRole("button", { name: "Open the case" });
    expect(open).toHaveFocus();
    // The timeline stays (the fields do not come back under it) and the button cannot be pressed twice.
    expect(screen.getByRole("button", { name: /Investigating/ })).toBeDisabled();
    fireEvent.click(open);
    expect(push).toHaveBeenCalledWith("/cases/case_abc");
  });

  it("opens the case by itself after a countdown, unless the person stays", async () => {
    const stream = liveResponse();
    vi.stubGlobal("fetch", vi.fn(async () => stream.res));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      send();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        stream.line(accepted());
        stream.line(done());
        stream.end();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText(/Opening the case in/)).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
      // One second at a time: each tick is a state change that schedules the next one.
      for (let i = 0; i < 6; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      expect(push).toHaveBeenCalledWith("/cases/case_abc");

      push.mockReset();
      fireEvent.click(screen.getByRole("button", { name: "Stay on this page" }));
      for (let i = 0; i < 8; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByText("Review the case when you are ready.")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("labels a DEMO MODE run as scripted, shows no timings, and never invents an outline", async () => {
    const stream = liveResponse();
    vi.stubGlobal("fetch", vi.fn(async () => stream.res));
    send(NONE);
    await screen.findByTestId("live-run");
    await act(async () => {
      stream.line(accepted("demo-mock"));
      stream.line(ev({ type: "run_started", engine: "demo-mock", model: "demo-mock", label: "DEMO MODE: deterministic mock, not Muse", mock: true, photos: 1 }));
      stream.line(ev({ type: "thinking", t: 2, turn: 1, phase: "start" }));
      stream.line(ev({ type: "tool_start", t: 3, tool: "mark_damage", turn: 1, calledBy: "model" }));
      stream.line(
        ev({
          type: "tool_end",
          t: 4,
          tool: "mark_damage",
          turn: 1,
          calledBy: "model",
          ok: true,
          ms: 1,
          result: { tool: "mark_damage", photoIndex: 0, concepts: [], method: "none", regions: 0, annotatedPath: null, note: "Raw photo: DEMO MODE. SAM was not called (no image was analysed)." },
        }),
      );
    });
    const panel = screen.getByTestId("live-run");
    expect(within(panel).getByTestId("live-run-mode")).toHaveTextContent("DEMO MODE (scripted)");
    expect(panel).toHaveTextContent("DEMO MODE: deterministic mock, not Muse");
    expect(await within(panel).findByText(/The scripted mock starts its script \(it reads no image\)/)).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/\+\d\.\d s/);
    expect(panel.querySelector('[data-step="mark_damage"]')).toHaveTextContent("No outline: the claim keeps the raw photo.");
    expect(within(panel).queryByRole("img")).not.toBeInTheDocument();
    stream.end();
  });

  it("paces a DEMO MODE run so each scripted step can be seen", async () => {
    const stream = liveResponse();
    vi.stubGlobal("fetch", vi.fn(async () => stream.res));
    send(NONE, { demoPaceMs: 120 });
    await screen.findByTestId("live-run");
    const started = Date.now();
    await act(async () => {
      stream.line(accepted("demo-mock"));
      stream.line(ev({ type: "tool_start", t: 3, tool: "get_order", turn: 1, calledBy: "model" }));
      stream.line(ev({ type: "tool_end", t: 4, tool: "get_order", turn: 1, calledBy: "model", ok: true, ms: 1, result: { tool: "get_order", found: true, order: ORDER } }));
      stream.line(done("demo-mock", 10));
      stream.end();
    });
    await screen.findByRole("heading", { name: "The case is ready" });
    // accepted, tool_start and tool_end each wait half the pace: the whole run did not flash by.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });
});

describe("when the stream does not end well", () => {
  it("returns to the form with the reason and a link to the stored case on an error event", async () => {
    const stream = liveResponse();
    vi.stubGlobal("fetch", vi.fn(async () => stream.res));
    send();
    await screen.findByTestId("live-run");
    await act(async () => {
      stream.line(accepted());
      stream.line({ type: "error", t: 900, code: "agent_failed", message: "The agent could not process this report.", caseId: "case_abc" });
      stream.end();
    });
    expect(await screen.findByText("The agent could not process this report.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the saved case" })).toHaveAttribute("href", "/cases/case_abc");
    expect(screen.queryByTestId("live-run")).not.toBeInTheDocument();
    // Everything typed is still there.
    expect(screen.getByLabelText("Order number")).toHaveValue("#1001");
    expect(screen.getByRole("button", { name: "Send report" })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("says the connection dropped, and links to the case that is being finished, when the stream just ends", async () => {
    const stream = liveResponse();
    vi.stubGlobal("fetch", vi.fn(async () => stream.res));
    send();
    await screen.findByTestId("live-run");
    await act(async () => {
      stream.line(accepted());
      stream.line(ev({ type: "tool_start", t: 100, tool: "get_order", turn: 1, calledBy: "model" }));
      stream.end();
    });
    expect(await screen.findByText(/The connection dropped before the agent finished/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the saved case" })).toHaveAttribute("href", "/cases/case_abc");
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores pings and lines it cannot read, and still finishes", async () => {
    const stream = liveResponse();
    vi.stubGlobal("fetch", vi.fn(async () => stream.res));
    send();
    await screen.findByTestId("live-run");
    await act(async () => {
      stream.line(accepted());
      stream.line({ type: "ping", t: 10_000 });
      stream.raw("this is not json\n");
      stream.line(done());
      stream.end();
    });
    expect(await screen.findByRole("heading", { name: "The case is ready" })).toBeInTheDocument();
  });

  it("still takes a plain JSON answer from a server that does not stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ caseId: "case-9" }) }) as Response));
    send();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/cases/case-9"));
  });

  it("shows a JSON error from the server (access code, validation) as before", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ message: "Access code needed." }) }) as Response),
    );
    send();
    expect(await screen.findByText("Access code needed.")).toBeInTheDocument();
    expect(screen.queryByTestId("live-run")).not.toBeInTheDocument();
  });
});
