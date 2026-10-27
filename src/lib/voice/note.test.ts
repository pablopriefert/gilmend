import { describe, expect, it } from "vitest";
import { parseVoiceNote } from "./note";

describe("parseVoiceNote", () => {
  it("keeps a well-formed label and names the model on a real transcription", () => {
    expect(parseVoiceNote(JSON.stringify({ durationMs: 12_345, demo: false, edited: true }), true)).toEqual({
      model: "muse-voice-transcribe-1.0",
      durationMs: 12_345,
      demo: false,
      edited: true,
    });
  });

  it("cannot claim a real transcription when the server has no key", () => {
    expect(parseVoiceNote(JSON.stringify({ durationMs: 3000, demo: false, edited: false }), false)).toMatchObject({
      model: "demo-mock",
      demo: true,
    });
  });

  it("labels a demo transcript as demo whatever the server has", () => {
    expect(parseVoiceNote(JSON.stringify({ durationMs: 3000, demo: true, edited: false }), true)).toMatchObject({
      model: "demo-mock",
      demo: true,
    });
  });

  it("clamps the duration and ignores junk instead of failing the report", () => {
    expect(parseVoiceNote(JSON.stringify({ durationMs: 9e9, demo: false }), true)?.durationMs).toBe(93_000);
    expect(parseVoiceNote(JSON.stringify({ durationMs: -5 }), true)?.durationMs).toBe(0);
    for (const bad of [null, undefined, "", "not json", "[]", "null", '{"durationMs":"12"}', "x".repeat(600)]) {
      expect(parseVoiceNote(bad, true)).toBeUndefined();
    }
  });
});
