import type {
  CarrierId,
  DamageSeverity,
  DamageType,
  DecisionKind,
  Engine,
  Evidence,
  Order,
  PhotoQuality,
} from "../types";

// Live progress events of one agent run (27 Oct 2026).
//
// runAgent emits them AS the work happens (a model turn starts, a tool starts and ends...), the
// route streams them to the browser as NDJSON, and the report page draws its timeline from them.
// Nothing here is an illustration: every event is emitted at the line of code that does the thing.
//
// PRIVACY: an event is meant to be shown to the person who filed the report, but it is also what
// a proxy or a log could see. It therefore never carries the API key, the bytes of a photo
// (a data URL is dropped, only a stored path is kept), the customer's name, e-mail or address,
// the customer's message, the model's free-text reasoning or its reply to the customer. What it
// carries are order ids, carrier names, item titles, enum values, counts, amounts and dates that
// come from tools. Free text that code does not control (model errors, the model's item name) goes
// through `scrub` first.
//
// This file is imported by the browser too: types and pure functions only, no node: imports.

/** One field of the order that the page may show (the order card). No name, e-mail, address. */
export interface OrderSummary {
  orderId: string;
  carrier: CarrierId;
  service: string;
  items: string[];
  deliveredAt: string | null;
  total: number;
  currency: string;
}

/** What a finished tool reports, by tool. The page shows these, it never re-derives them. */
export type ToolResult =
  | { tool: "get_order"; found: boolean; order: OrderSummary | null }
  | {
      tool: "assess_photos";
      item: string;
      damageType: DamageType;
      severity: DamageSeverity;
      photoQuality: PhotoQuality;
    }
  | {
      tool: "mark_damage";
      photoIndex: number;
      /** The concepts SAM was asked for (what the model or the code named), not what matched. */
      concepts: string[];
      method: "sam-3.1" | "none";
      regions: number;
      /** Stored path of the annotated image once it is saved; null when nothing was outlined. Never a data URL. */
      annotatedPath: string | null;
      note: string;
    }
  | { tool: "get_carrier_rules"; carrier: CarrierId; label: string }
  | {
      tool: "compute_claim";
      eligible: boolean;
      maxCompensationEur: number;
      claimDeadline: string | null;
      daysLeft: number | null;
    }
  | {
      tool: "finish_case";
      decision: DecisionKind;
      confidence: number;
      needsHuman: boolean;
      carrierClaim: boolean;
    }
  | { tool: "draft_claim_document"; ok: true };

export type AgentNoticeCode =
  /** The model was not shown the photos (no image input, or its server refused them). */
  | "photos_withheld"
  /** A photo could not be read and was not sent to the model. */
  | "photo_unreadable"
  /** The run ended without a decision from the model (budget, step limit, error). */
  | "agent_incomplete"
  /** The model failed after it had recorded a decision. */
  | "agent_error";

/** Fields added by the emitter; every event carries `t`, ms since the run started. */
interface Timed {
  t: number;
}

export type AgentEvent = Timed &
  (
    | {
        type: "run_started";
        engine: Engine;
        /** Model id actually used ("demo-mock" for the scripted mock). Never a key. */
        model: string;
        /** Full name of what runs, e.g. "Muse Spark 1.3 (Meta Model API)". */
        label: string;
        /** True when the model is the scripted mock: nothing it says comes from a model. */
        mock: boolean;
        /** Photos in the report. */
        photos: number;
        /**
         * Photos actually attached to the model's opening message (28 Oct 2026). It is below `photos`
         * when a photo could not be read, and 0 when the model is text-only: the page must not say the
         * model "read the photos" then. A `photos_withheld` notice later in the run (the server refused
         * the images) brings it back to 0.
         */
        photosSent: number;
      }
    | { type: "thinking"; turn: number; phase: "start" }
    | { type: "thinking"; turn: number; phase: "end"; ok: boolean; toolCalls: number; ms: number }
    | { type: "tool_start"; tool: string; turn: number; calledBy: "model" | "code" }
    | {
        type: "tool_end";
        tool: string;
        turn: number;
        calledBy: "model" | "code";
        ok: boolean;
        ms: number;
        result: ToolResult | null;
        /** Short, scrubbed reason when `ok` is false. */
        error?: string;
      }
    | { type: "guardrail"; message: string }
    | { type: "notice"; code: AgentNoticeCode; message: string }
    | {
        type: "run_finished";
        /** False when the agent never reached a decision of its own (see the `notice` before it). */
        reachedDecision: boolean;
        decision: DecisionKind;
        confidence: number;
        needsHuman: boolean;
        carrierClaim: boolean;
        ms: number;
      }
  );

/** Distributes Omit over the union so `emit({ type: "thinking", ... })` still narrows. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type AgentEventInput = DistributiveOmit<AgentEvent, "t">;

/** Called with each event. It must be quick and must not throw: the agent ignores what it throws. */
export type AgentEventSink = (event: AgentEvent) => void;

// ---- the stream the route sends (NDJSON, one JSON object per line) ---------------------

/** What the route says about the engine, once the report is stored and before the agent starts. */
export interface RunOutcomeFields {
  caseId: string;
  engine: Engine;
  requestedEngine: Engine;
  /** True when the server could not honour the requested engine (no key, daily ceiling). */
  fellBack: boolean;
  fellBackReason: "no_credentials" | "daily_limit" | null;
}

export type StreamEvent =
  | AgentEvent
  | ({ type: "accepted"; t: number } & RunOutcomeFields)
  | ({ type: "done"; t: number; status: string } & RunOutcomeFields)
  | { type: "error"; t: number; code: string; message: string; caseId?: string }
  /** A keep-alive for proxies; carries nothing. */
  | { type: "ping"; t: number };

export const NDJSON_CONTENT_TYPE = "application/x-ndjson";

// ---- scrubbing -------------------------------------------------------------------------

/**
 * Make a free-text string safe to put in an event: no data URL, e-mail address, URL, or
 * token-looking run of characters (an API key echoed in a provider error, for example), and a
 * length cap. Meant for text that code does not control; it is not a general redactor.
 */
export function scrub(value: unknown, max = 160): string {
  const text = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  const cleaned = text
    .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[image]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[credential]")
    // A key, a token, a hash: 20+ characters of key alphabet with no space and a digit, mixed case or a
    // key prefix. A long snake_case name (a tool, a field) has none of these and is left alone.
    .replace(/[A-Za-z0-9_\-+/=]{20,}/g, (run) =>
      /\d/.test(run) || (/[a-z]/.test(run) && /[A-Z]/.test(run)) || /^(?:sk|pk|rk|key|tok)[-_]/i.test(run) ? "[token]" : run,
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** A stored image path is fine to send; a data URL is the photo itself and never is. */
export function storedPathOrNull(path: string | null | undefined): string | null {
  if (!path) return null;
  const p = path.trim();
  if (p === "" || /^data:/i.test(p)) return null;
  return p;
}

// ---- building the summaries ------------------------------------------------------------

/** The part of an order the page may show: what was bought and how it was shipped, not who bought it. */
export function summarizeOrder(order: Order): OrderSummary {
  return {
    orderId: scrub(order.id, 40),
    carrier: order.carrier,
    service: scrub(order.service, 80),
    items: (Array.isArray(order.lineItems) ? order.lineItems : []).slice(0, 5).map((l) => scrub(l?.title, 80)),
    deliveredAt: order.deliveredAt,
    total: order.total,
    currency: order.currency,
  };
}

/** The mark_damage result of one photo: the counts and the stored path, never the image. */
export function summarizeMarkDamage(photoIndex: number, concepts: readonly string[], ev: Evidence): ToolResult {
  const annotatedPath = storedPathOrNull(ev.annotatedPhoto);
  return {
    tool: "mark_damage",
    photoIndex,
    concepts: concepts.slice(0, 6).map((c) => scrub(c, 40)),
    method: ev.method,
    regions: ev.method === "sam-3.1" ? (ev.regions ?? 0) : 0,
    annotatedPath,
    note: scrub(ev.note, 240),
  };
}

// ---- reading a stream ------------------------------------------------------------------

/** Parse one NDJSON line; null for a blank line, a broken one, or an object without a string `type`. */
export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string") {
      return value as StreamEvent;
    }
  } catch {
    // A partial or garbled line carries nothing the page could trust.
  }
  return null;
}

/**
 * Yield the events of an NDJSON response body as they arrive. Lines may be split across chunks
 * (and a chunk may hold several lines): the buffer keeps the unfinished line for the next chunk.
 */
export async function* readStreamEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const event = parseStreamLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (event) yield event;
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const last = parseStreamLine(buffer);
    if (last) yield last;
  } finally {
    // Stops the download when the caller leaves the loop early (the user went to the case).
    reader.cancel().catch(() => {});
  }
}
