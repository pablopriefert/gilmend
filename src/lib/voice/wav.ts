import { MAX_VOICE_SECONDS, VOICE_SECONDS_GRACE } from "./limits";

// Muse Voice Transcribe takes "a RIFF/WAVE container holding mono integer PCM at 16 kHz or
// 24 kHz" (dev.meta.ai/docs/speech-to-text, read 2026-10-27) and answers 400 otherwise. The
// browser encodes that format itself (src/components/voice-wav.ts), so the server only has to
// check the header: it refuses a wrong file before spending an API call, and it learns the
// duration without decoding anything. No audio library needed.

export type WavProblem = "not_wav" | "unsupported_format" | "empty" | "too_long";

export type WavCheck =
  | { ok: true; durationMs: number; sampleRate: number }
  | { ok: false; problem: WavProblem; message: string };

const SAMPLE_RATES = new Set([16_000, 24_000]);

export function inspectWav(bytes: Uint8Array): WavCheck {
  const fail = (problem: WavProblem, message: string): WavCheck => ({ ok: false, problem, message });
  if (bytes.length < 44) return fail("not_wav", "The recording is not a WAV file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return fail("not_wav", "The recording is not a WAV file.");

  // Walk the chunks: "fmt " and "data" are not always at fixed offsets (LIST chunks exist).
  let format: { code: number; channels: number; rate: number; bits: number } | null = null;
  let dataBytes = -1;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      format = {
        code: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      // A streamed WAV can declare a size past the end of the file: trust what is there.
      dataBytes = Math.min(size, bytes.length - body);
      break;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (!format || dataBytes < 0) return fail("not_wav", "The recording is not a valid WAV file.");
  if (format.code !== 1 || format.channels !== 1 || format.bits !== 16 || !SAMPLE_RATES.has(format.rate)) {
    return fail("unsupported_format", "The recording must be mono 16-bit PCM WAV at 16 kHz or 24 kHz.");
  }
  const durationMs = Math.round((dataBytes / 2 / format.rate) * 1000);
  if (durationMs < 300) return fail("empty", "The recording is too short: nothing to transcribe.");
  if (durationMs > (MAX_VOICE_SECONDS + VOICE_SECONDS_GRACE) * 1000) {
    return fail("too_long", `The recording is longer than ${MAX_VOICE_SECONDS} seconds.`);
  }
  return { ok: true, durationMs, sampleRate: format.rate };
}

/** Build a WAV file from 16-bit mono samples. Used by tests and by the browser encoder. */
export function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) out[offset + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // integer PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i], true);
  return out;
}
