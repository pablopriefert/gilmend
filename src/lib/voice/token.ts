import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "../config";
import { VOICE_MODEL } from "./limits";

// A signed receipt for a real transcription. POST /api/transcribe hands one back with each
// transcript Muse Voice Transcribe really produced, and POST /api/reports only labels a message
// "transcribed by Muse" when the receipt checks out. Without it, the `voiceNote` form field is
// just the browser's word, and anyone could attach a real-looking label to a typed message (and
// switch on the agent's leniency about misheard names). The receipt binds the transcript text, so
// it also tells the server which words were dictated and which the customer changed afterwards.
//
// Stateless on purpose: no database, and any serverless instance can check what another issued.

/** A receipt is for a message being written now, not for one kept for days. */
export const VOICE_TOKEN_TTL_MS = 30 * 60_000;
/** Clock drift between two instances. */
const FUTURE_SLACK_MS = 60_000;

interface Receipt {
  /** SHA-256 of the transcript, hex. */
  h: string;
  /** Duration in ms, as measured on the server. */
  d: number;
  /** Speech model. */
  m: string;
  /** Issued at, epoch ms. */
  t: number;
}

/**
 * The signing key is derived from the model key, which only a server that can really transcribe
 * has: no key, no receipt, and no new variable to set. Rotating the key voids the receipts
 * issued before (at most 30 minutes of them).
 */
function signingKey(env: Env): Buffer | null {
  const key = env.MODEL_API_KEY?.trim();
  if (!key) return null;
  return createHmac("sha256", key).update("damage-desk/voice-receipt/v1").digest();
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sign(payload: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(payload).digest();
}

/** A receipt for `transcript`, or null when this server has no key to sign with. */
export function issueVoiceReceipt(
  transcript: string,
  durationMs: number,
  env: Env = process.env,
  now: number = Date.now(),
): string | null {
  const key = signingKey(env);
  if (!key) return null;
  const receipt: Receipt = { h: sha256Hex(transcript), d: Math.round(durationMs), m: VOICE_MODEL, t: now };
  const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  return `${payload}.${sign(payload, key).toString("base64url")}`;
}

/**
 * The server-measured duration (ms) when `token` is a valid, recent receipt for exactly this
 * transcript; null for anything else (forged, expired, another text, no key here).
 */
export function verifyVoiceReceipt(
  token: unknown,
  transcript: string,
  env: Env = process.env,
  now: number = Date.now(),
): number | null {
  const key = signingKey(env);
  if (!key || typeof token !== "string" || token.length > 600) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = sign(payload, key);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let receipt: Partial<Receipt>;
  try {
    receipt = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Receipt>;
  } catch {
    return null;
  }
  if (
    typeof receipt.h !== "string" ||
    typeof receipt.d !== "number" ||
    typeof receipt.t !== "number" ||
    receipt.m !== VOICE_MODEL
  ) {
    return null;
  }
  if (receipt.h !== sha256Hex(transcript)) return null;
  if (receipt.t > now + FUTURE_SLACK_MS || now - receipt.t > VOICE_TOKEN_TTL_MS) return null;
  return receipt.d;
}
