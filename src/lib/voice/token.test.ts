import { describe, expect, it } from "vitest";
import { VOICE_TOKEN_TTL_MS, issueVoiceReceipt, verifyVoiceReceipt } from "./token";

const ENV = { MODEL_API_KEY: "fake-key-for-test" }; // secret-factice
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

describe("voice receipt", () => {
  it("round-trips for exactly the transcript it was issued for and gives back the duration", () => {
    const token = issueVoiceReceipt("My vase arrived broken.", 4200, ENV, NOW)!;
    expect(verifyVoiceReceipt(token, "My vase arrived broken.", ENV, NOW + 1000)).toBe(4200);
  });

  it("is not issued without a model key, and verifies nothing without one", () => {
    expect(issueVoiceReceipt("Hello there.", 1000, {}, NOW)).toBeNull();
    const token = issueVoiceReceipt("Hello there.", 1000, ENV, NOW)!;
    expect(verifyVoiceReceipt(token, "Hello there.", {}, NOW)).toBeNull();
  });

  it("refuses another text, a tampered payload, a foreign key and junk", () => {
    const token = issueVoiceReceipt("My vase arrived broken.", 4200, ENV, NOW)!;
    expect(verifyVoiceReceipt(token, "My vase arrived broken!", ENV, NOW)).toBeNull();
    expect(verifyVoiceReceipt(token, "My vase arrived broken.", { MODEL_API_KEY: "another-key" }, NOW)).toBeNull(); // secret-factice

    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), d: 90_000 })).toString("base64url");
    expect(verifyVoiceReceipt(`${forged}.${signature}`, "My vase arrived broken.", ENV, NOW)).toBeNull();

    for (const bad of [undefined, null, 42, "", "abc", "a.b.c", `${payload}.`, ".sig", "x".repeat(700)]) {
      expect(verifyVoiceReceipt(bad, "My vase arrived broken.", ENV, NOW)).toBeNull();
    }
  });

  it("expires, and refuses a receipt from the future", () => {
    const token = issueVoiceReceipt("Hello there.", 1000, ENV, NOW)!;
    expect(verifyVoiceReceipt(token, "Hello there.", ENV, NOW + VOICE_TOKEN_TTL_MS)).toBe(1000);
    expect(verifyVoiceReceipt(token, "Hello there.", ENV, NOW + VOICE_TOKEN_TTL_MS + 1)).toBeNull();
    expect(verifyVoiceReceipt(token, "Hello there.", ENV, NOW - 61_000)).toBeNull();
  });
});
