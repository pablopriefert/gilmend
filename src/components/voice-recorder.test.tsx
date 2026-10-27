// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceRecorder } from "./voice-recorder";

vi.mock("./voice-wav", () => ({
  blobToWav: vi.fn(async () => new Blob([new Uint8Array(100)], { type: "audio/wav" })),
}));

const track = { stop: vi.fn() };
const getUserMedia = vi.fn();

// Just enough of MediaRecorder: start() does nothing, stop() flushes one chunk then fires onstop,
// as the real one does.
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (t: string) => t === "audio/webm";
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  emptyClip = false;
  constructor(
    readonly stream: unknown,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    if (!this.emptyClip) this.ondataavailable?.({ data: new Blob([new Uint8Array(500)], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

function setup(over: Partial<React.ComponentProps<typeof VoiceRecorder>> = {}) {
  const onTranscript = vi.fn();
  render(<VoiceRecorder language="auto" accessCode="" onTranscript={onTranscript} {...over} />);
  return onTranscript;
}

const start = () => fireEvent.click(screen.getByRole("button", { name: "Record a voice message" }));
const stop = () => fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));

function mockTranscribe(response: { ok: boolean; body: unknown }) {
  const fetchMock = vi.fn(async () => ({ ok: response.ok, status: response.ok ? 200 : 502, json: async () => response.body }) as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  FakeRecorder.instances = [];
  track.stop.mockReset();
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue({ getTracks: () => [track] });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // @ts-expect-error -- remove the stub so another test file starts without a microphone
  delete navigator.mediaDevices;
});

describe("VoiceRecorder", () => {
  it("records, uploads the WAV with the access code and language, and hands over the transcript", async () => {
    const fetchMock = mockTranscribe({
      ok: true,
      body: { transcript: "My vase arrived broken.", durationMs: 3100, model: "muse-voice-transcribe-1.0", demo: false, voiceReceipt: "receipt.sig" },
    });
    const onTranscript = setup({ language: "en", accessCode: " judges-2026 " });

    start();
    await screen.findByRole("button", { name: "Stop recording" });
    expect(screen.getByRole("timer")).toHaveTextContent("0:00 / 1:30");
    expect(screen.getByRole("status")).toHaveTextContent("Recording");
    expect(FakeRecorder.instances[0].mimeType).toBe("audio/webm"); // first supported candidate
    stop();

    await waitFor(() => expect(onTranscript).toHaveBeenCalled());
    expect(onTranscript).toHaveBeenCalledWith({
      transcript: "My vase arrived broken.",
      durationMs: 3100,
      model: "muse-voice-transcribe-1.0",
      demo: false,
      voiceReceipt: "receipt.sig",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/transcribe");
    expect((init.headers as Record<string, string>)["x-access-code"]).toBe("judges-2026");
    const form = init.body as FormData;
    expect(form.get("language")).toBe("en");
    expect((form.get("audio") as File).type).toBe("audio/wav");
    expect(track.stop).toHaveBeenCalled(); // the microphone is released
    expect(screen.getByRole("status")).toHaveTextContent("Transcribed by Muse Voice Transcribe");
    expect(screen.getByRole("button", { name: "Record a voice message" })).toBeEnabled();
  });

  it("does not send a language when it is on auto", async () => {
    const fetchMock = mockTranscribe({ ok: true, body: { transcript: "Bonjour.", durationMs: 1, model: "x", demo: false } });
    setup();
    start();
    await screen.findByRole("button", { name: "Stop recording" });
    stop();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData).has("language")).toBe(false);
  });

  it("says plainly when the transcript is a demo one, and never claims Muse transcribed it", async () => {
    mockTranscribe({ ok: true, body: { transcript: "Hello, my vase…", durationMs: 3000, model: "demo-mock", demo: true } });
    const onTranscript = setup();
    start();
    await screen.findByRole("button", { name: "Stop recording" });
    stop();
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith(expect.objectContaining({ demo: true, model: "demo-mock" })));
    expect(screen.getByRole("status")).toHaveTextContent(/DEMO MODE: this is a canned sentence/);
    expect(screen.getByRole("status")).not.toHaveTextContent(/Transcribed by Muse/);
  });

  it("shows the server's message and leaves the form alone when the transcription fails", async () => {
    mockTranscribe({ ok: false, body: { message: "We could not hear any speech." } });
    const onTranscript = setup();
    start();
    await screen.findByRole("button", { name: "Stop recording" });
    stop();
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not hear any speech.");
    expect(onTranscript).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Record a voice message" })).toBeEnabled();
  });

  it("explains a refused microphone and does not start recording", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    setup();
    start();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Microphone access was refused/);
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Record a voice message" })).toBeInTheDocument();
  });

  it("reports an empty recording without calling the server", async () => {
    const fetchMock = mockTranscribe({ ok: true, body: {} });
    setup();
    start();
    await screen.findByRole("button", { name: "Stop recording" });
    FakeRecorder.instances[0].emptyClip = true;
    stop();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Nothing was recorded/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts the time and stops by itself at the 90 s limit", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    mockTranscribe({ ok: true, body: { transcript: "ok", durationMs: 1, model: "x", demo: false } });
    setup();
    start();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(7_000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("0:07 / 1:30");
    await act(async () => {
      vi.advanceTimersByTime(84_000);
    });
    expect(FakeRecorder.instances[0].state).toBe("inactive");
  });

  it("never passes on a receipt for a demo transcript, whatever the answer carries", async () => {
    mockTranscribe({ ok: true, body: { transcript: "Hello.", durationMs: 1, model: "demo-mock", demo: true, voiceReceipt: "smuggled.sig" } });
    const onTranscript = setup();
    start();
    await screen.findByRole("button", { name: "Stop recording" });
    stop();
    await waitFor(() => expect(onTranscript).toHaveBeenCalled());
    expect(onTranscript.mock.calls[0][0].voiceReceipt).toBeUndefined();
  });

  it("keeps Stop recording usable when the form becomes busy, so the microphone can always be closed", async () => {
    const { rerender } = render(<VoiceRecorder language="auto" accessCode="" onTranscript={vi.fn()} />);
    start();
    await screen.findByRole("button", { name: "Stop recording" });
    rerender(<VoiceRecorder language="auto" accessCode="" disabled onTranscript={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeEnabled();
  });

  it("tells the form while it is busy (recording, then transcribing) and when it is free again", async () => {
    mockTranscribe({ ok: true, body: { transcript: "Hello.", durationMs: 1, model: "x", demo: false } });
    const onBusyChange = vi.fn();
    setup({ onBusyChange });
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    start();
    await screen.findByRole("button", { name: "Stop recording" });
    // The busy signal is sent from an effect, which can land a tick after the button under a
    // loaded test run (seen failing once in the full suite on 27 Oct 2026).
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
    stop();
    await screen.findByRole("button", { name: "Record a voice message" });
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  });

  it("frees the form when it is removed from the page mid-recording", async () => {
    const onBusyChange = vi.fn();
    const { unmount } = render(<VoiceRecorder language="auto" accessCode="" onTranscript={vi.fn()} onBusyChange={onBusyChange} />);
    start();
    await screen.findByRole("button", { name: "Stop recording" });
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("can be disabled (while the report is being sent)", () => {
    setup({ disabled: true });
    expect(screen.getByRole("button", { name: "Record a voice message" })).toBeDisabled();
  });

  it("switches the microphone off when the page is left mid-recording", async () => {
    const { unmount } = render(<VoiceRecorder language="auto" accessCode="" onTranscript={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Record a voice message" }).at(-1)!);
    await screen.findByRole("button", { name: "Stop recording" });
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it("says so, and offers no button, when the browser cannot record", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    setup();
    expect(await screen.findByText(/Voice messages are not supported in this browser/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
