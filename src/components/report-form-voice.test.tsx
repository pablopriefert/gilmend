// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportForm } from "./report-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => "/report" }));
vi.mock("./voice-wav", () => ({ blobToWav: vi.fn(async () => new Blob([new Uint8Array(100)], { type: "audio/wav" })) }));

class FakeRecorder {
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(500)]) });
    this.onstop?.();
  }
}

const NONE = { museKey: false, openWeights: false };
const message = () => screen.getByLabelText("Message from the customer") as HTMLTextAreaElement;

/** Record, stop, and let /api/transcribe answer `transcribeBody`; /api/reports answers a case. */
function stubServer(transcribeBody: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) =>
    url === "/api/transcribe"
      ? ({ ok: true, json: async () => transcribeBody }) as Response
      : ({ ok: true, json: async () => ({ caseId: "case-9" }) }) as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function dictate() {
  fireEvent.click(await screen.findByRole("button", { name: "Record a voice message" }));
  fireEvent.click(await screen.findByRole("button", { name: "Stop recording" }));
}

const SAID = { transcript: "My vase arrived broken.", durationMs: 4200, model: "muse-voice-transcribe-1.0", demo: false };

beforeEach(() => {
  push.mockReset();
  let n = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:photo-${n++}`, revokeObjectURL: () => {} }));
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
    configurable: true,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error -- leave no microphone behind for the other test files
  delete navigator.mediaDevices;
});

function sendReport() {
  fireEvent.change(screen.getByLabelText("Order number"), { target: { value: "#1001" } });
  fireEvent.change(screen.getByLabelText("E-mail used for the order"), { target: { value: "camille@example.com" } });
  fireEvent.change(screen.getByLabelText(/Photos of the damage/), {
    target: { files: [new File([new Uint8Array(2000)], "vase.jpg", { type: "image/jpeg" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));
}

describe("report form, voice message", () => {
  it("fills the message with the transcript, keeps it editable and sends a voiceNote label", async () => {
    const fetchMock = stubServer(SAID);
    render(<ReportForm availability={NONE} />);
    await dictate();

    await waitFor(() => expect(message().value).toBe("My vase arrived broken."));
    // The customer can still change the text...
    fireEvent.change(message(), { target: { value: "My vase arrived broken. It was a gift." } });
    sendReport();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/cases/case-9"));
    const reportCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u === "/api/reports")!;
    const body = reportCall[1].body as FormData;
    expect(body.get("message")).toBe("My vase arrived broken. It was a gift.");
    // ...which still contains the transcript, so it is "sent as transcribed" plus an addition.
    expect(JSON.parse(body.get("voiceNote") as string)).toEqual({ durationMs: 4200, demo: false, edited: false });
  });

  it("marks the note as edited when the transcript was corrected before sending", async () => {
    const fetchMock = stubServer({ ...SAID, transcript: "May vas arrivé brocant." });
    render(<ReportForm availability={NONE} />);
    await dictate();
    await waitFor(() => expect(message().value).toBe("May vas arrivé brocant."));
    fireEvent.change(message(), { target: { value: "My vase arrived broken." } });
    sendReport();

    await waitFor(() => expect(push).toHaveBeenCalled());
    const body = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u === "/api/reports")![1].body as FormData;
    expect(JSON.parse(body.get("voiceNote") as string)).toMatchObject({ edited: true });
  });

  it("appends to what was already typed instead of replacing it", async () => {
    stubServer(SAID);
    render(<ReportForm availability={NONE} />);
    fireEvent.change(message(), { target: { value: "Hello," } });
    await dictate();
    await waitFor(() => expect(message().value).toBe("Hello,\n\nMy vase arrived broken."));
  });

  it("flags a demo transcript, and sends no label for a typed message", async () => {
    const fetchMock = stubServer({ ...SAID, model: "demo-mock", demo: true });
    render(<ReportForm availability={NONE} />);
    await dictate();
    await waitFor(() => expect(screen.getByText(/DEMO MODE: this is a canned sentence/)).toBeInTheDocument());
    fireEvent.change(message(), { target: { value: "" } }); // emptied: typed from scratch from now on
    fireEvent.change(message(), { target: { value: "Typed by hand." } });
    sendReport();
    await waitFor(() => expect(push).toHaveBeenCalled());
    const body = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u === "/api/reports")![1].body as FormData;
    expect(body.get("voiceNote")).toBeNull();
  });
});
