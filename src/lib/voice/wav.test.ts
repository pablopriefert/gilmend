import { describe, expect, it } from "vitest";
import { encodeWav, inspectWav } from "./wav";

const tone = (seconds: number, rate = 16_000) => new Int16Array(Math.round(seconds * rate)).fill(1000);

describe("inspectWav", () => {
  it("reads the duration of a mono 16-bit WAV at 16 kHz and at 24 kHz", () => {
    expect(inspectWav(encodeWav(tone(2.5), 16_000))).toEqual({ ok: true, durationMs: 2500, sampleRate: 16_000 });
    expect(inspectWav(encodeWav(tone(1, 24_000), 24_000))).toMatchObject({ ok: true, durationMs: 1000 });
  });

  it("refuses something that is not a WAV, whatever its declared type", () => {
    expect(inspectWav(new TextEncoder().encode("this is just text, not audio at all, sorry about that!!"))).toMatchObject({
      ok: false,
      problem: "not_wav",
    });
    expect(inspectWav(new Uint8Array(10))).toMatchObject({ ok: false, problem: "not_wav" });
  });

  it("refuses a format the API would reject: stereo, 44.1 kHz, 8-bit", () => {
    const wav = encodeWav(tone(1), 16_000);
    const view = new DataView(wav.buffer);

    const stereo = wav.slice();
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(inspectWav(stereo)).toMatchObject({ ok: false, problem: "unsupported_format" });

    const cd = wav.slice();
    new DataView(cd.buffer).setUint32(24, 44_100, true);
    expect(inspectWav(cd)).toMatchObject({ ok: false, problem: "unsupported_format" });

    const eightBit = wav.slice();
    new DataView(eightBit.buffer).setUint16(34, 8, true);
    expect(inspectWav(eightBit)).toMatchObject({ ok: false, problem: "unsupported_format" });
    expect(view.getUint16(34, true)).toBe(16); // the original is untouched
  });

  it("refuses a clip that is too short or too long", () => {
    expect(inspectWav(encodeWav(tone(0.1), 16_000))).toMatchObject({ ok: false, problem: "empty" });
    expect(inspectWav(encodeWav(tone(95), 16_000))).toMatchObject({ ok: false, problem: "too_long" });
    // The recorder stops at 90 s by timer: a second of jitter is accepted.
    expect(inspectWav(encodeWav(tone(91), 16_000))).toMatchObject({ ok: true });
  });

  it("finds the data chunk after an extra chunk, and tolerates a declared size past the end", () => {
    const plain = encodeWav(tone(1), 16_000);
    const extra = new Uint8Array([...new TextEncoder().encode("LIST"), 4, 0, 0, 0, 1, 2, 3, 4]);
    const withList = new Uint8Array([...plain.slice(0, 36), ...extra, ...plain.slice(36)]);
    expect(inspectWav(withList)).toMatchObject({ ok: true, durationMs: 1000 });

    const streamed = plain.slice();
    new DataView(streamed.buffer).setUint32(40, 0xffffffff, true);
    expect(inspectWav(streamed)).toMatchObject({ ok: true, durationMs: 1000 });
  });
});
