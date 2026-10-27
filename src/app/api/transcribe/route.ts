import { hasModelKey } from "@/lib/config";
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS, VOICE_MODEL } from "@/lib/voice/limits";
import { issueVoiceReceipt } from "@/lib/voice/token";
import { TranscribeError, transcribeAudio } from "@/lib/voice/transcribe";
import { inspectWav } from "@/lib/voice/wav";
import { accessCodeRequired, hasValidAccessCode } from "../_lib/access";
import { clientKey, rateLimit } from "../_lib/rate-limit";
import { errorResponse } from "../_lib/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// One short clip to one API call (30 s timeout in transcribeAudio): well under a minute.
export const maxDuration = 60;

// A transcription costs a few cents per hour of audio, so it is cheap next to a report, but
// the public URL still gets a per-client cap. Its own bucket: dictating a message must not
// use up the reports' allowance. Local development is not limited, as in /api/reports.
const RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };
const MAX_BODY_BYTES = MAX_VOICE_BYTES + 64 * 1024;

// What the form gets back when no real transcription can happen. It is a canned sentence, NOT
// what the customer said, and the response says so (`demo: true`): the page labels it and the
// case records `voiceNote.demo`. It is never presented as coming from Muse Voice Transcribe.
const DEMO_TRANSCRIPTS: Record<string, string> = {
  en: "Hello, my vase arrived broken this morning. My order number is 1001. I attached a photo.",
  fr: "Bonjour, mon vase est arrivé cassé ce matin. Ma commande est la 1001. Je joins une photo.",
};

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.arrayBuffer === "function" &&
    typeof value.size === "number"
  );
}

/**
 * POST /api/transcribe: speech to text for a spoken damage report.
 * multipart/form-data with `audio` (a mono 16-bit PCM WAV at 16 or 24 kHz, at most
 * MAX_VOICE_SECONDS long: the browser encodes it) and an optional `language` ("en" or "fr").
 * Answers `{ transcript, durationMs, model, demo, fellBackReason, voiceReceipt }`; the receipt is
 * signed and only present on a real transcription (see lib/voice/token.ts). The audio is held in
 * memory for the call and never written to disk.
 *
 * Without MODEL_API_KEY, or on a public deployment without the access code, it answers a
 * labelled canned transcript (`demo: true`) instead of failing, as POST /api/reports does.
 */
export async function POST(request: Request): Promise<Response> {
  const limited =
    process.env.NODE_ENV === "development"
      ? { ok: true, retryAfterSeconds: 0 }
      : rateLimit(`transcribe:${clientKey(request)}`, RATE_LIMIT);
  if (!limited.ok) {
    const res = errorResponse(429, "rate_limited", "Too many voice messages in a short time. Try again in a few minutes.");
    res.headers.set("Retry-After", String(limited.retryAfterSeconds));
    return res;
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse(413, "too_large", `The recording is too large (max ${MAX_VOICE_SECONDS} seconds).`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "invalid_form", "Send the recording as multipart/form-data.");
  }

  const audio = form.get("audio");
  if (!isUploadedFile(audio)) {
    return errorResponse(400, "invalid_audio", "Attach the recording in an `audio` field.");
  }
  if (audio.size > MAX_VOICE_BYTES) {
    return errorResponse(413, "too_large", `The recording is too large (max ${MAX_VOICE_SECONDS} seconds).`);
  }
  const bytes = new Uint8Array(await audio.arrayBuffer());
  // The declared type is only what the client claims: read the real header, which also gives
  // the duration. A wrong file is refused here instead of costing an API call.
  const wav = inspectWav(bytes);
  if (!wav.ok) {
    return errorResponse(wav.problem === "too_long" ? 413 : 400, "invalid_audio", wav.message);
  }

  const languageField = form.get("language");
  const language = typeof languageField === "string" ? languageField.trim().toLowerCase() : "";
  const knownLanguage = language === "en" || language === "fr" ? language : undefined;

  // Same two reasons as the reports route, in the same order.
  let fellBackReason: "no_credentials" | "access_code" | null = null;
  if (!hasModelKey()) fellBackReason = "no_credentials";
  else if (accessCodeRequired() && !hasValidAccessCode(request)) fellBackReason = "access_code";

  if (fellBackReason) {
    return Response.json(
      {
        transcript: DEMO_TRANSCRIPTS[knownLanguage ?? "en"],
        durationMs: wav.durationMs,
        model: "demo-mock",
        demo: true,
        fellBackReason,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await transcribeAudio(bytes, { language: knownLanguage });
    // Our own header reading, as the API's audioDurationMs can be missing.
    const durationMs = result.durationMs || wav.durationMs;
    return Response.json(
      {
        transcript: result.transcript,
        durationMs,
        model: VOICE_MODEL,
        demo: false,
        fellBackReason: null,
        // Proof, for POST /api/reports, that these words came out of the speech model. Only a
        // real transcription gets one: a canned demo text never does.
        voiceReceipt: issueVoiceReceipt(result.transcript, durationMs),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof TranscribeError) {
      // The log gets the kind of failure and the status, never the key or the body.
      console.error(`[damage-desk] transcription failed: ${err.code}${err.status ? ` (${err.status})` : ""}`);
      switch (err.code) {
        case "empty":
          return errorResponse(422, "no_speech", "We could not hear any speech. Record again, closer to the microphone, or type the message.");
        case "bad_audio":
          return errorResponse(400, "invalid_audio", "The recording could not be transcribed. Record it again or type the message.");
        case "rate_limited": {
          const res = errorResponse(429, "rate_limited", "The transcription service is busy. Try again in a moment, or type the message.");
          res.headers.set("Retry-After", "10");
          return res;
        }
        default:
          // "unauthorized" is a server misconfiguration: not the visitor's business.
          return errorResponse(502, "transcription_failed", "The transcription service is not available right now. Type the message instead.");
      }
    }
    console.error("[damage-desk] transcription failed:", err instanceof Error ? err.name : "unknown error");
    return errorResponse(502, "transcription_failed", "The transcription service is not available right now. Type the message instead.");
  }
}
