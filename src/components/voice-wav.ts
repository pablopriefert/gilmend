import { VOICE_SAMPLE_RATE } from "@/lib/voice/limits";
import { encodeWav } from "@/lib/voice/wav";

// MediaRecorder gives WebM/Opus (Chrome, Firefox) or MP4/AAC (Safari), and Muse Voice
// Transcribe only takes WAV: mono 16-bit PCM at 16 or 24 kHz. Converting in the browser keeps
// ffmpeg off the server and the upload small (a 90 s clip is ~2.9 MB as 16 kHz mono).
// decodeAudioData reads whatever the browser itself recorded, and an OfflineAudioContext with
// one channel at 16 kHz does the resampling and the mono mix-down.

type AudioContextCtor = typeof AudioContext;

function audioContextClass(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export async function blobToWav(blob: Blob): Promise<Blob> {
  const Ctx = audioContextClass();
  if (!Ctx || typeof OfflineAudioContext === "undefined") {
    throw new Error("This browser cannot convert the recording to WAV.");
  }
  const context = new Ctx();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * VOICE_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, VOICE_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const floats = rendered.getChannelData(0);
    const pcm = new Int16Array(floats.length);
    for (let i = 0; i < floats.length; i += 1) {
      const s = Math.max(-1, Math.min(1, floats[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return new Blob([new Uint8Array(encodeWav(pcm, VOICE_SAMPLE_RATE))], { type: "audio/wav" });
  } finally {
    void context.close().catch(() => {});
  }
}
