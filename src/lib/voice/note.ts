import type { VoiceNote } from "../types";
import { MAX_VOICE_SECONDS, VOICE_MODEL, VOICE_SECONDS_GRACE } from "./limits";

/**
 * Read the `voiceNote` form field of POST /api/reports. The browser fills it in after a
 * transcription; it is a label, not proof, so it is parsed strictly and cannot claim more
 * than the server could have done: with no model key, nothing was transcribed for real.
 * Anything malformed means "typed message" (undefined), never an error: a bad label must not
 * block a damage report.
 */
export function parseVoiceNote(raw: unknown, serverHasKey: boolean): VoiceNote | undefined {
  if (typeof raw !== "string" || raw === "" || raw.length > 500) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const { durationMs, demo, edited } = value as Record<string, unknown>;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return undefined;
  const maxMs = (MAX_VOICE_SECONDS + VOICE_SECONDS_GRACE) * 1000;
  const isDemo = demo === true || !serverHasKey;
  return {
    model: isDemo ? "demo-mock" : VOICE_MODEL,
    durationMs: Math.round(Math.min(maxMs, Math.max(0, durationMs))),
    demo: isDemo,
    edited: edited === true,
  };
}
