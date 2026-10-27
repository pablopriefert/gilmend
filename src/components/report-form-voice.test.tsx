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

const reportBody = (fetchMock: ReturnType<typeof stubServer>) =>
  (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u === "/api/reports")![1].body as FormData;
const voiceNoteField = (fetchMock: ReturnType<typeof stubServer>) => JSON.parse(reportBody(fetchMock).get("voiceNote") as string);

const SAID = { transcript: "My vase arrived broken.", durationMs: 4200, model: "muse-voice-transcribe-1.0", demo: false, voiceReceipt: "receipt-1.sig" };

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
  // The Arc dropzone keeps its file input hidden: it is the one input of that type on the page.
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, {
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
    // The page sends what the server needs to judge for itself: the transcript, its receipt and the
    // duration. It no longer decides "demo" or "edited" (a label the client controls proves nothing).
    expect(JSON.parse(body.get("voiceNote") as string)).toEqual({
      clips: [{ transcript: "My vase arrived broken.", durationMs: 4200, token: "receipt-1.sig" }],
    });
  });

  it("still sends the original transcript when it was corrected, so the server can see the change", async () => {
    const fetchMock = stubServer({ ...SAID, transcript: "May vas arrivé brocant." });
    render(<ReportForm availability={NONE} />);
    await dictate();
    await waitFor(() => expect(message().value).toBe("May vas arrivé brocant."));
    fireEvent.change(message(), { target: { value: "My vase arrived broken." } });
    sendReport();

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(reportBody(fetchMock).get("message")).toBe("My vase arrived broken.");
    expect(voiceNoteField(fetchMock).clips[0].transcript).toBe("May vas arrivé brocant.");
  });

  it("keeps every dictation, not only the last one", async () => {
    const answers = [
      { ...SAID, transcript: "First sentence.", durationMs: 3000, voiceReceipt: "r1.sig" },
      { ...SAID, transcript: "Second sentence.", durationMs: 2000, voiceReceipt: "r2.sig" },
    ];
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/transcribe"
        ? ({ ok: true, json: async () => answers.shift() }) as Response
        : ({ ok: true, json: async () => ({ caseId: "case-9" }) }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportForm availability={NONE} />);
    await dictate();
    await waitFor(() => expect(message().value).toBe("First sentence."));
    await dictate();
    await waitFor(() => expect(message().value).toBe("First sentence.\n\nSecond sentence."));
    sendReport();

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(voiceNoteField(fetchMock).clips).toEqual([
      { transcript: "First sentence.", durationMs: 3000, token: "r1.sig" },
      { transcript: "Second sentence.", durationMs: 2000, token: "r2.sig" },
    ]);
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
    expect(reportBody(fetchMock).get("voiceNote")).toBeNull();
  });

  it("sends no receipt for a demo transcript", async () => {
    const fetchMock = stubServer({ transcript: "Hello, my vase…", durationMs: 3000, model: "demo-mock", demo: true });
    render(<ReportForm availability={NONE} />);
    await dictate();
    await waitFor(() => expect(message().value).toBe("Hello, my vase…"));
    sendReport();
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(voiceNoteField(fetchMock).clips).toEqual([{ transcript: "Hello, my vase…", durationMs: 3000 }]);
  });
});

describe("report form, voice message and the private engine", () => {
  const PRIVATE = { museKey: true, openWeights: true };
  const pickPrivate = () => fireEvent.click(screen.getByRole("radio", { name: /Run privately \(open weights\)/ }));

  it("replaces the recorder with an explanation when Run privately is chosen: no audio can go to Meta", async () => {
    stubServer(SAID);
    render(<ReportForm availability={PRIVATE} />);
    expect(await screen.findByRole("button", { name: "Record a voice message" })).toBeInTheDocument();
    pickPrivate();
    expect(screen.queryByRole("button", { name: "Record a voice message" })).not.toBeInTheDocument();
    expect(screen.getByText(/Voice input uses the Meta API, which is unavailable in private mode/)).toBeInTheDocument();
  });

  it("keeps the recorder when Run privately is not configured on the server (the report runs in demo mode anyway)", async () => {
    stubServer(SAID);
    render(<ReportForm availability={{ museKey: true, openWeights: false }} />);
    pickPrivate();
    expect(await screen.findByRole("button", { name: "Record a voice message" })).toBeInTheDocument();
  });

  it("refuses to send a message dictated with the Meta API as a private run, and warns about it", async () => {
    const fetchMock = stubServer(SAID);
    render(<ReportForm availability={PRIVATE} />);
    await dictate();
    await waitFor(() => expect(message().value).toBe("My vase arrived broken."));
    pickPrivate();
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/dictated with the Meta API, so it cannot run privately/);
    sendReport();
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/reports")).toBe(false);
    expect(push).not.toHaveBeenCalled();

    // Typed again from scratch, the report goes through as a private run.
    fireEvent.change(message(), { target: { value: "" } });
    fireEvent.change(message(), { target: { value: "My vase arrived broken." } });
    sendReport();
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(reportBody(fetchMock).get("engine")).toBe("open-weights");
    expect(reportBody(fetchMock).get("voiceNote")).toBeNull();
  });

  it("lets a demo dictation (nothing was sent to Meta) run privately", async () => {
    const fetchMock = stubServer({ transcript: "Hello, my vase…", durationMs: 3000, model: "demo-mock", demo: true });
    render(<ReportForm availability={PRIVATE} />);
    await dictate();
    await waitFor(() => expect(message().value).toBe("Hello, my vase…"));
    pickPrivate();
    sendReport();
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(reportBody(fetchMock).get("engine")).toBe("open-weights");
  });
});

describe("report form, a recording still open", () => {
  it("does not send the report while the microphone is open, and says why", async () => {
    const fetchMock = stubServer(SAID);
    render(<ReportForm availability={NONE} />);
    fireEvent.click(await screen.findByRole("button", { name: "Record a voice message" }));
    await screen.findByRole("button", { name: "Stop recording" });
    fireEvent.change(message(), { target: { value: "My vase arrived broken." } });
    sendReport();

    expect(await screen.findByText("Stop the recording and wait for the transcript before sending the report.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/reports")).toBe(false);
    // Stop is still there to close the microphone.
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeEnabled();

    // Once the clip is transcribed the report can go, with the dictation in it.
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    await waitFor(() => expect(message().value).toContain("My vase arrived broken."));
    sendReport();
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(voiceNoteField(fetchMock).clips).toHaveLength(1);
  });
});
