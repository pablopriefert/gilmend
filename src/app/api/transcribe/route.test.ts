import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeWav } from "@/lib/voice/wav";
import { resetRateLimits } from "../_lib/rate-limit";

const transcribeAudio = vi.fn();
vi.mock("@/lib/voice/transcribe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/transcribe")>();
  return { ...actual, transcribeAudio: (...args: unknown[]) => transcribeAudio(...args) };
});

import { TranscribeError } from "@/lib/voice/transcribe";
import { POST } from "./route";

const clip = (seconds = 3) => encodeWav(new Int16Array(Math.round(seconds * 16_000)).fill(500), 16_000);

function request(
  over: { audio?: Uint8Array | null; fields?: Record<string, string>; headers?: Record<string, string> } = {},
): Request {
  const form = new FormData();
  if (over.audio !== null) {
    form.append("audio", new File([new Uint8Array(over.audio ?? clip())], "voice-message.wav", { type: "audio/wav" }));
  }
  for (const [k, v] of Object.entries(over.fields ?? {})) form.set(k, v);
  return new Request("http://localhost/api/transcribe", { method: "POST", body: form, headers: over.headers });
}

beforeEach(() => {
  vi.stubEnv("MODEL_API_KEY", "");
  vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "");
  resetRateLimits();
  transcribeAudio.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/transcribe, demo mode", () => {
  it("without a key answers a labelled canned transcript and calls no model", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      demo: true,
      model: "demo-mock",
      fellBackReason: "no_credentials",
      durationMs: 3000,
      transcript: expect.stringContaining("vase"),
    });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("answers the canned text in the requested language", async () => {
    const res = await POST(request({ fields: { language: "fr" } }));
    expect((await res.json()).transcript).toMatch(/^Bonjour/);
  });

  it("on a public deployment, a real key without the access code still falls back to demo mode", async () => {
    vi.stubEnv("MODEL_API_KEY", "k"); // secret-factice
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "judges-2026");
    const without = await POST(request());
    expect(await without.json()).toMatchObject({ demo: true, fellBackReason: "access_code" });
    const wrong = await POST(request({ headers: { "x-access-code": "nope" } }));
    expect((await wrong.json()).fellBackReason).toBe("access_code");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });
});

describe("POST /api/transcribe, real mode", () => {
  beforeEach(() => vi.stubEnv("MODEL_API_KEY", "k")); // secret-factice

  it("transcribes with Muse Voice Transcribe and passes the language bias", async () => {
    transcribeAudio.mockResolvedValue({ transcript: "My vase arrived broken.", durationMs: 3120, model: "muse-voice-transcribe-1.0" });
    const res = await POST(request({ fields: { language: "en" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      transcript: "My vase arrived broken.",
      durationMs: 3120,
      model: "muse-voice-transcribe-1.0",
      demo: false,
      fellBackReason: null,
    });
    expect(transcribeAudio.mock.calls[0][1]).toEqual({ language: "en" });
  });

  it("accepts the right access code on a public deployment", async () => {
    vi.stubEnv("DAMAGE_DESK_ACCESS_CODE", "judges-2026");
    transcribeAudio.mockResolvedValue({ transcript: "Hello.", durationMs: 0, model: "muse-voice-transcribe-1.0" });
    const res = await POST(request({ headers: { "x-access-code": "judges-2026" } }));
    expect(await res.json()).toMatchObject({ demo: false, durationMs: 3000 }); // falls back to our own header reading
  });

  it("ignores an unknown language instead of passing it on", async () => {
    transcribeAudio.mockResolvedValue({ transcript: "Hallo.", durationMs: 1, model: "muse-voice-transcribe-1.0" });
    await POST(request({ fields: { language: "klingon" } }));
    expect(transcribeAudio.mock.calls[0][1]).toEqual({ language: undefined });
  });

  it("turns service failures into clear answers without leaking details", async () => {
    transcribeAudio.mockRejectedValueOnce(new TranscribeError("empty", "No speech", 200));
    const empty = await POST(request());
    expect(empty.status).toBe(422);
    expect((await empty.json()).error).toBe("no_speech");

    transcribeAudio.mockRejectedValueOnce(new TranscribeError("rate_limited", "busy", 429));
    const busy = await POST(request());
    expect(busy.status).toBe(429);
    expect(busy.headers.get("Retry-After")).toBe("10");

    transcribeAudio.mockRejectedValueOnce(new TranscribeError("unauthorized", "refused key sk-123", 401));
    const misconfigured = await POST(request());
    expect(misconfigured.status).toBe(502);
    const text = JSON.stringify(await misconfigured.json());
    expect(text).not.toContain("sk-123");
    expect(text).not.toContain("401");

    transcribeAudio.mockRejectedValueOnce(new Error("kaboom"));
    expect((await POST(request())).status).toBe(502);
  });
});

describe("POST /api/transcribe, bad input", () => {
  it("refuses a missing audio part, a non-WAV file, a wrong format and a clip that is too long", async () => {
    const missing = await POST(request({ audio: null }));
    expect(missing.status).toBe(400);

    const text = await POST(request({ audio: new TextEncoder().encode("not audio, only a long enough sentence to pass 44 bytes!!") }));
    expect(text.status).toBe(400);
    expect((await text.json()).error).toBe("invalid_audio");

    const stereo = clip();
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect((await POST(request({ audio: stereo }))).status).toBe(400);

    const long = await POST(request({ audio: clip(100) }));
    expect(long.status).toBe(413);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("refuses a body that is not multipart and an oversized upload", async () => {
    const notForm = await POST(new Request("http://localhost/api/transcribe", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(notForm.status).toBe(400);
    expect((await notForm.json()).error).toBe("invalid_form");

    const huge = await POST(new Request("http://localhost/api/transcribe", { method: "POST", body: "x", headers: { "content-length": String(50 * 1024 * 1024) } }));
    expect(huge.status).toBe(413);
  });

  it("limits each client, and keeps its own bucket", async () => {
    let last = 200;
    for (let i = 0; i < 21; i += 1) last = (await POST(request({ headers: { "x-forwarded-for": "203.0.113.9" } }))).status;
    expect(last).toBe(429);
    // another client is not affected
    expect((await POST(request({ headers: { "x-forwarded-for": "203.0.113.10" } }))).status).toBe(200);
  });
});
