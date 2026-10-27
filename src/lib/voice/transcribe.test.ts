import { describe, expect, it, vi } from "vitest";
import { buildTranscribeSettings, TranscribeError, transcribeAudio, transcribeEndpoint } from "./transcribe";
import { encodeWav } from "./wav";

const KEY = "test-key-do-not-leak"; // secret-factice
const env = { MODEL_API_KEY: KEY };
const wav = encodeWav(new Int16Array(16_000), 16_000);

function answer(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("transcribe settings and endpoint", () => {
  it("posts to /asr/transcribe on the Meta Model API by default", () => {
    expect(transcribeEndpoint({})).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(transcribeEndpoint({ MODEL_BASE_URL: "https://example.test/v1/" })).toBe("https://example.test/v1/asr/transcribe");
  });

  it("builds the documented settings: Standard model, WAV, one turn, a language bias only when known", () => {
    expect(buildTranscribeSettings()).toEqual({ mode: "PUSH_TO_TALK", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" });
    expect(buildTranscribeSettings("fr")).toMatchObject({ languageBias: ["French"] });
    expect(buildTranscribeSettings("en")).toMatchObject({ languageBias: ["English"] });
    expect(buildTranscribeSettings("de")).not.toHaveProperty("languageBias");
    expect(JSON.stringify(buildTranscribeSettings("en"))).not.toMatch(/contributor/i);
  });
});

describe("transcribeAudio", () => {
  it("sends the multipart request with the Bearer key and returns the transcript", async () => {
    const fetchImpl = answer(200, { sessionId: "s", transcript: " My vase   arrived broken. ", audioDurationMs: 3120, turns: [] });
    const result = await transcribeAudio(wav, { env, fetchImpl, language: "en" });
    expect(result).toEqual({ transcript: "My vase arrived broken.", durationMs: 3120, model: "muse-voice-transcribe-1.0" });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.meta.ai/v1/asr/transcribe");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const form = init.body as FormData;
    const settings = JSON.parse(await (form.get("request") as Blob).text());
    expect(settings).toMatchObject({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", languageBias: ["English"] });
    expect((form.get("audio") as File).size).toBe(wav.length);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps each HTTP failure to a stable code, and no message carries the key or the body", async () => {
    const cases: Array<[number, string]> = [
      [400, "bad_audio"],
      [413, "bad_audio"],
      [401, "unauthorized"],
      [403, "unauthorized"],
      [429, "rate_limited"],
      [500, "unavailable"],
      [503, "unavailable"],
    ];
    for (const [status, code] of cases) {
      const err = await transcribeAudio(wav, { env, fetchImpl: answer(status, { error: `boom ${KEY}` }) }).catch((e) => e);
      expect(err).toBeInstanceOf(TranscribeError);
      expect(err.code).toBe(code);
      expect(err.status).toBe(status);
      expect(`${err.message} ${err.stack}`).not.toContain(KEY);
      expect(err.message).not.toContain("boom");
    }
  });

  it("reports an empty transcript, an unreadable answer and an unreachable service", async () => {
    await expect(transcribeAudio(wav, { env, fetchImpl: answer(200, { transcript: "  ", turns: [] }) })).rejects.toMatchObject({ code: "empty" });
    await expect(transcribeAudio(wav, { env, fetchImpl: answer(200, "<html>") })).rejects.toMatchObject({ code: "unavailable" });
    const down = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED https://api.meta.ai/ with ${KEY}`);
    }) as unknown as typeof fetch;
    const err = await transcribeAudio(wav, { env, fetchImpl: down }).catch((e) => e);
    expect(err).toMatchObject({ code: "unavailable" });
    expect(err.message).not.toContain(KEY);
    expect(err.message).not.toContain("api.meta.ai");
  });

  it("times out instead of hanging", async () => {
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;
    await expect(transcribeAudio(wav, { env, fetchImpl: hang, timeoutMs: 20 })).rejects.toMatchObject({
      code: "unavailable",
      message: "The transcription timed out.",
    });
  });

  it("refuses to run without a key, before any request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(transcribeAudio(wav, { env: {}, fetchImpl })).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
