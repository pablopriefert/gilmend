"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_VOICE_SECONDS } from "@/lib/voice/limits";
import { accessHeaders } from "./access-code";
import { blobToWav } from "./voice-wav";

export interface VoiceResult {
  transcript: string;
  durationMs: number;
  model: string;
  /** Canned text: the server could not transcribe for real (no key, no access code). */
  demo: boolean;
  /** Signed proof that the server transcribed this text (absent on a demo transcript). */
  voiceReceipt?: string;
}

type Phase = "idle" | "recording" | "transcribing";

// First type the browser supports wins; an unknown list entry is skipped, and a browser that
// cannot tell gets its own default.
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function micMessage(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was refused. Allow it in your browser, or type the message.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Type the message instead.";
  }
  return "The microphone could not be started. Type the message instead.";
}

/**
 * "Record a voice message": the customer speaks, the clip is converted to WAV in the browser,
 * sent to POST /api/transcribe (Muse Voice Transcribe) and the text goes back to the form
 * through `onTranscript`, where it stays editable. Nothing is recorded until the button is
 * pressed, and the audio is never stored: it lives in memory until the transcript comes back.
 */
export function VoiceRecorder({
  language,
  accessCode,
  disabled,
  onTranscript,
  onBusyChange,
}: {
  language: "auto" | "en" | "fr";
  accessCode: string;
  disabled?: boolean;
  onTranscript: (result: VoiceResult) => void;
  /** True while a clip is being recorded or transcribed: the form must not be sent meanwhile. */
  onBusyChange?: (busy: boolean) => void;
}) {
  // Decided after mount so the server render and the first client render agree.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const mounted = useRef(true);
  // The props can change while a clip is being recorded or sent: the callback side reads the latest.
  const latest = useRef({ language, accessCode, onTranscript, onBusyChange });
  useEffect(() => {
    latest.current = { language, accessCode, onTranscript, onBusyChange };
  });

  useEffect(() => {
    latest.current.onBusyChange?.(phase !== "idle");
  }, [phase]);

  useEffect(() => {
    mounted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capability check, needs the client
    setSupported(typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined");
    return () => {
      // Leaving the page must switch the microphone (and its browser indicator) off.
      mounted.current = false;
      // A recorder removed from the page (private mode) must not leave the form believing it is busy.
      latest.current.onBusyChange?.(false);
      if (timer.current) clearInterval(timer.current);
      const r = recorder.current;
      if (r && r.state !== "inactive") {
        r.onstop = null;
        r.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function releaseMicrophone(): void {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  async function transcribe(blob: Blob): Promise<void> {
    try {
      const wav = await blobToWav(blob);
      const body = new FormData();
      body.set("audio", new File([wav], "voice-message.wav", { type: "audio/wav" }));
      if (latest.current.language !== "auto") body.set("language", latest.current.language);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body,
        headers: accessHeaders(latest.current.accessCode),
      });
      const data = (await res.json().catch(() => null)) as
        | (Partial<VoiceResult> & { message?: string })
        | null;
      if (!mounted.current) return;
      if (!res.ok || !data?.transcript) {
        setError(data?.message ?? "The voice message could not be transcribed. Type the message instead.");
        setStatus("");
        return;
      }
      const demo = data.demo === true;
      latest.current.onTranscript({
        transcript: data.transcript,
        durationMs: data.durationMs ?? 0,
        model: data.model ?? (demo ? "demo-mock" : "muse-voice-transcribe-1.0"),
        demo,
        voiceReceipt: demo ? undefined : data.voiceReceipt,
      });
      setStatus(
        demo
          ? "DEMO MODE: this is a canned sentence, not what you said. No speech model was called."
          : "Transcribed by Muse Voice Transcribe. Read it and fix any mistake before sending.",
      );
    } catch {
      if (!mounted.current) return;
      setError("The recording could not be processed. Type the message instead.");
      setStatus("");
    } finally {
      if (mounted.current) setPhase("idle");
    }
  }

  async function start(): Promise<void> {
    setError(null);
    setStatus("");
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(micMessage(err));
      return;
    }
    if (!mounted.current) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    stream.current = media;
    chunks.current = [];
    let rec: MediaRecorder;
    try {
      const mimeType = pickMimeType();
      rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
    } catch {
      releaseMicrophone();
      setError("This browser cannot record audio. Type the message instead.");
      return;
    }
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      releaseMicrophone();
      if (!mounted.current) return;
      const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size === 0) {
        setPhase("idle");
        setError("Nothing was recorded. Check your microphone and try again.");
        return;
      }
      setPhase("transcribing");
      setStatus("Transcribing your voice message…");
      void transcribe(blob);
    };
    recorder.current = rec;
    rec.start();
    startedAt.current = Date.now();
    setElapsed(0);
    setPhase("recording");
    setStatus("Recording. Press Stop recording when you are done.");
    timer.current = setInterval(() => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      setElapsed(seconds);
      if (seconds >= MAX_VOICE_SECONDS) stop();
    }, 250);
  }

  function stop(): void {
    const r = recorder.current;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (r && r.state !== "inactive") r.stop();
  }

  if (supported === null) return null;
  if (!supported) {
    return (
      <p className="text-xs text-muted">
        Voice messages are not supported in this browser (or the page is not served over HTTPS). Type the message instead.
      </p>
    );
  }

  const recording = phase === "recording";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => (recording ? stop() : void start())}
          // Stop stays available while recording even if the form is busy: the microphone must
          // always be possible to close.
          disabled={(disabled && !recording) || phase === "transcribing"}
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
            recording ? "border-danger bg-danger-soft text-danger" : "border-border bg-surface hover:bg-background"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${recording ? "motion-safe:animate-pulse bg-danger" : "bg-accent"}`}
          />
          {recording ? "Stop recording" : "Record a voice message"}
        </button>
        {recording && (
          <span role="timer" aria-label="Recording time" className="text-sm tabular-nums text-muted">
            {clock(elapsed)} / {clock(MAX_VOICE_SECONDS)}
          </span>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-xs text-muted">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
