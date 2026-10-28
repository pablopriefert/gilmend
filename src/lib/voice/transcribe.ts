import { assertStandardModel, META_API_BASE_URL, type Env } from "../config";
import { supportedLanguageName } from "../languages";
import { VOICE_MODEL } from "./limits";

// Muse Voice Transcribe on the Meta Model API. Shape read on dev.meta.ai/docs/speech-to-text
// and /docs/api-reference/voice/* and checked with one real call on 2026-10-27:
//  - POST {base}/asr/transcribe, same Bearer key as Muse Spark (not /audio/transcriptions:
//    this is not the OpenAI shape, so the openai SDK is not used here);
//  - multipart/form-data with two parts: `request` (JSON, content type application/json:
//    model, audioEncoding "WAV", mode, optional languageBias as language NAMES) and `audio`;
//  - PUSH_TO_TALK (the default) treats the clip as a single turn, which is what a spoken
//    message is; the answer is JSON { sessionId, transcript, audioDurationMs, turns: [] };
//  - 400 wrong audio, 413 body over 32 MB, 429 rate limit, 500 failure or server timeout.
// Language is detected by the model unless we pass a bias, and a bias is only a hint. German,
// Spanish and Italian are passed by name like English and French (28 Oct 2026); only English
// and French were tried against the real API, so check a German clip before relying on it.

export const TRANSCRIBE_TIMEOUT_MS = 30_000;


export type TranscribeFailure =
  | "bad_audio" // the API refused the audio (400, 413)
  | "rate_limited" // 429
  | "unavailable" // 5xx, network, timeout
  | "unauthorized" // 401/403: the server key is wrong or lacks the voice model
  | "empty"; // 200 but nothing was heard

/**
 * Carries a stable code and a message that is safe to show: never the request, the response
 * body or the key (a failed call used to be the easiest way to leak a header into a log).
 */
export class TranscribeError extends Error {
  constructor(
    readonly code: TranscribeFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TranscribeError";
  }
}

export interface TranscribeOptions {
  /** A supported language code (en, fr, de, es, it) biases the model; anything else (or nothing) lets it detect the language. */
  language?: string;
  env?: Env;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface Transcription {
  transcript: string;
  durationMs: number;
  model: string;
}

export function transcribeEndpoint(env: Env = process.env): string {
  const base = (env.MODEL_BASE_URL || META_API_BASE_URL).replace(/\/+$/, "");
  return `${base}/asr/transcribe`;
}

export function buildTranscribeSettings(language?: string): Record<string, unknown> {
  const name = language ? supportedLanguageName(language) : undefined;
  return {
    mode: "PUSH_TO_TALK",
    // Checked here as well as at the config level so no path reaches a Contributor model.
    model: assertStandardModel(VOICE_MODEL),
    audioEncoding: "WAV",
    ...(name ? { languageBias: [name] } : {}),
  };
}

/** Send a WAV clip (already validated by `inspectWav`) and return what was said. */
export async function transcribeAudio(wav: Uint8Array, options: TranscribeOptions = {}): Promise<Transcription> {
  const env = options.env ?? process.env;
  const key = env.MODEL_API_KEY?.trim();
  if (!key) throw new TranscribeError("unauthorized", "No model key is configured on the server.");

  const form = new FormData();
  form.append(
    "request",
    new Blob([JSON.stringify(buildTranscribeSettings(options.language))], { type: "application/json" }),
  );
  form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voice-message.wav");

  let res: Response;
  try {
    res = await (options.fetchImpl ?? fetch)(transcribeEndpoint(env), {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(options.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    // Only the kind of failure is kept: the error text of a fetch can carry the URL.
    throw new TranscribeError("unavailable", timedOut ? "The transcription timed out." : "The transcription service could not be reached.");
  }

  if (!res.ok) {
    if (res.status === 400 || res.status === 413) {
      throw new TranscribeError("bad_audio", "The transcription service did not accept this recording.", res.status);
    }
    if (res.status === 401 || res.status === 403) {
      throw new TranscribeError("unauthorized", "The transcription service refused the server's credentials.", res.status);
    }
    if (res.status === 429) {
      throw new TranscribeError("rate_limited", "The transcription service is busy. Try again in a moment.", 429);
    }
    throw new TranscribeError("unavailable", "The transcription service failed.", res.status);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new TranscribeError("unavailable", "The transcription service sent an unreadable answer.", res.status);
  }
  const record = (body && typeof body === "object" ? body : {}) as { transcript?: unknown; audioDurationMs?: unknown };
  const transcript = typeof record.transcript === "string" ? record.transcript.replace(/\s+/g, " ").trim() : "";
  if (!transcript) throw new TranscribeError("empty", "No speech was recognised in the recording.", res.status);
  const durationMs =
    typeof record.audioDurationMs === "number" && Number.isFinite(record.audioDurationMs) ? record.audioDurationMs : 0;
  return { transcript, durationMs, model: VOICE_MODEL };
}
