// Shared by the browser (recorder) and the server (route, transcribe client): plain
// constants only, no Node or DOM import, so the two sides cannot drift apart.

/** The speech-to-text model on the Meta Model API (Standard mode, no "-contributor" id). */
export const VOICE_MODEL = "muse-voice-transcribe-1.0";

/**
 * Longest voice message. The API itself takes 10 minutes, but a damage report is a few
 * sentences, and a 16 kHz mono clip of 90 s is ~2.9 MB: under the 4.5 MB body limit of a
 * Vercel function, which a longer clip would hit before it reached our code.
 */
export const MAX_VOICE_SECONDS = 90;
/** The browser stops at MAX_VOICE_SECONDS by timer; a little jitter must not be refused. */
export const VOICE_SECONDS_GRACE = 3;

/** The format the API accepts and the browser produces: WAV, mono, 16-bit PCM, 16 kHz. */
export const VOICE_SAMPLE_RATE = 16_000;

export const MAX_VOICE_BYTES = 3.5 * 1024 * 1024;
