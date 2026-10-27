import type { Env } from "../config";
import { MAX_MESSAGE_CHARS } from "@/components/report-validation";
import type { VoiceNote } from "../types";
import { MAX_VOICE_SECONDS, VOICE_MODEL, VOICE_SECONDS_GRACE } from "./limits";
import { verifyVoiceReceipt } from "./token";

/** Dictating twice or three times is normal; more than this is not a damage report. */
const MAX_CLIPS = 8;
/** 8 clips of a message at the limit, plus a receipt (about 250 characters) each. */
const MAX_RAW_CHARS = MAX_CLIPS * (MAX_MESSAGE_CHARS + 600);

interface Clip {
  transcript: string;
  durationMs: number;
  token: unknown;
}

function readClips(raw: unknown): Clip[] | undefined {
  if (typeof raw !== "string" || raw === "" || raw.length > MAX_RAW_CHARS) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const list = (value as { clips?: unknown } | null)?.clips;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CLIPS) return undefined;
  const clips: Clip[] = [];
  for (const item of list) {
    const { transcript, durationMs, token } = (item ?? {}) as Record<string, unknown>;
    if (typeof transcript !== "string" || transcript.trim() === "" || transcript.length > MAX_MESSAGE_CHARS) return undefined;
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return undefined;
    clips.push({ transcript, durationMs, token });
  }
  return clips;
}

/**
 * Read the `voiceNote` form field of POST /api/reports: the transcripts the browser put in the
 * message, each with the receipt POST /api/transcribe signed for it (see ./token). The field is
 * the browser's word, so nothing in it is believed on its own:
 *  - "transcribed by Muse" needs a valid, recent receipt for EVERY clip, and the duration then
 *    comes from the receipt. A clip without one (canned demo text, a forged or expired label,
 *    a text the server never produced) makes the whole note a labelled demo one;
 *  - `edited` and `partial` are worked out here from the message actually sent: a transcript
 *    that is no longer in it word for word, and typed text around or between the transcripts.
 * Anything malformed means "typed message" (undefined), never an error: a bad label must not
 * block a damage report.
 */
export function parseVoiceNote(
  raw: unknown,
  message: string,
  env: Env = process.env,
  now: number = Date.now(),
): VoiceNote | undefined {
  const clips = readClips(raw);
  if (!clips) return undefined;

  const maxMs = (MAX_VOICE_SECONDS + VOICE_SECONDS_GRACE) * 1000;
  let verified = true;
  let durationMs = 0;
  let rest = message;
  let edited = false;
  for (const clip of clips) {
    const measured = verifyVoiceReceipt(clip.token, clip.transcript, env, now);
    if (measured === null) verified = false;
    durationMs += Math.min(maxMs, Math.max(0, measured ?? clip.durationMs));
    if (message.includes(clip.transcript)) rest = rest.split(clip.transcript).join(" ");
    else edited = true;
  }
  return {
    model: verified ? VOICE_MODEL : "demo-mock",
    durationMs: Math.round(durationMs),
    demo: !verified,
    edited,
    partial: rest.trim() !== "",
  };
}
