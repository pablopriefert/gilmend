import { describe, expect, it } from "vitest";
import { parseVoiceNote } from "./note";
import { issueVoiceReceipt } from "./token";

const ENV: Record<string, string | undefined> = { MODEL_API_KEY: "fake-key-for-test" }; // secret-factice
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

/** A clip as the browser sends it: the transcript, and the receipt the server signed for it. */
function clip(transcript: string, durationMs = 4000, signed = true) {
  return { transcript, durationMs, token: signed ? issueVoiceReceipt(transcript, durationMs, ENV, NOW) : undefined };
}
const field = (...clips: ReturnType<typeof clip>[]) => JSON.stringify({ clips });
const parse = (raw: unknown, message: string, env = ENV) => parseVoiceNote(raw, message, env, NOW);

describe("parseVoiceNote", () => {
  it("names the model and keeps the server-measured duration when every clip has a valid receipt", () => {
    const text = "My vase arrived broken.";
    expect(parse(field(clip(text, 12_345)), text)).toEqual({
      model: "muse-voice-transcribe-1.0",
      durationMs: 12_345,
      demo: false,
      edited: false,
      partial: false,
    });
  });

  it("ignores the duration the browser claims when the receipt says otherwise", () => {
    const text = "My vase arrived broken.";
    const raw = JSON.stringify({ clips: [{ transcript: text, durationMs: 80_000, token: issueVoiceReceipt(text, 3000, ENV, NOW) }] });
    expect(parse(raw, text)?.durationMs).toBe(3000);
  });

  it("cannot claim a real transcription without a valid receipt: forged, missing, expired or for another text", () => {
    const text = "My vase arrived broken.";
    // The old forgery: a typed message with a made-up duration and demo:false.
    expect(parse(JSON.stringify({ durationMs: 5000, demo: false }), text)).toBeUndefined();
    expect(parse(field(clip(text, 5000, false)), text)).toMatchObject({ model: "demo-mock", demo: true });
    const otherText = issueVoiceReceipt("Something else entirely.", 5000, ENV, NOW);
    expect(parse(JSON.stringify({ clips: [{ transcript: text, durationMs: 5000, token: otherText }] }), text)).toMatchObject({ demo: true });
    expect(parseVoiceNote(field(clip(text)), text, ENV, NOW + 31 * 60_000)).toMatchObject({ demo: true });
    // A server with no key never transcribed anything.
    expect(parse(field(clip(text)), text, {})).toMatchObject({ model: "demo-mock", demo: true });
  });

  it("is a demo note as soon as one clip lacks a receipt", () => {
    const a = "First part.";
    const b = "Second part.";
    expect(parse(field(clip(a), clip(b, 4000, false)), `${a}\n\n${b}`)).toMatchObject({ model: "demo-mock", demo: true });
  });

  it("works out edited and partial from the message that is actually sent", () => {
    const a = "My vase arrived broken.";
    const b = "The box was soaked.";
    // Verbatim, with a typed sentence before and after: not edited, but partly typed.
    expect(parse(field(clip(a)), `Hello. ${a} Thanks.`)).toMatchObject({ edited: false, partial: true });
    // Two dictations, nothing else: verbatim and the durations add up.
    expect(parse(field(clip(a, 3000), clip(b, 2000)), `${a}\n\n${b}`)).toMatchObject({ edited: false, partial: false, durationMs: 5000 });
    // The FIRST transcript was corrected: edited, even though the last one is intact.
    expect(parse(field(clip(a), clip(b)), `My vase arrived cracked.\n\n${b}`)).toMatchObject({ edited: true });
    // Everything rewritten.
    expect(parse(field(clip(a)), "Typed from scratch.")).toMatchObject({ edited: true, partial: true });
  });

  it("clamps the duration and ignores junk instead of failing the report", () => {
    const text = "Hello there.";
    expect(parse(JSON.stringify({ clips: [{ transcript: text, durationMs: 9e9 }] }), text)?.durationMs).toBe(93_000);
    expect(parse(JSON.stringify({ clips: [{ transcript: text, durationMs: -5 }] }), text)?.durationMs).toBe(0);
    const tooMany = JSON.stringify({ clips: Array.from({ length: 9 }, () => ({ transcript: text, durationMs: 1 })) });
    for (const bad of [
      null,
      undefined,
      "",
      "not json",
      "[]",
      "null",
      "{}",
      '{"clips":[]}',
      '{"clips":"x"}',
      '{"clips":[{"transcript":"","durationMs":1}]}',
      '{"clips":[{"transcript":"Hi","durationMs":"12"}]}',
      '{"clips":[null]}',
      tooMany,
      "x".repeat(100_000),
    ]) {
      expect(parse(bad, text)).toBeUndefined();
    }
  });
});
