import { describe, expect, it } from "vitest";
import { parseStreamLine, readStreamEvents, scrub, storedPathOrNull, summarizeMarkDamage, summarizeOrder } from "./events";
import { makeOrder } from "./test-helpers";

describe("scrub", () => {
  it("drops what must never leave the server in a progress event", () => {
    expect(scrub("401 Incorrect API key provided: sk-abcdefghijklmnopqrstuvwxyz0123456789")).not.toMatch(/sk-abcdef/);
    expect(scrub("see https://api.example.com/v1/orders?token=abc123 for more")).toBe("see [url] for more");
    expect(scrub("ada@example.com asked")).toBe("[email] asked");
    expect(scrub("Authorization: Bearer abc.def.ghi")).toMatch(/\[credential\]/);
    expect(scrub(`photo data:image/png;base64,${"A".repeat(500)} here`)).toBe("photo [image] here");
  });

  it("keeps ordinary short text, collapses whitespace and caps the length", () => {
    expect(scrub("order lookup failed:\n  timeout")).toBe("order lookup failed: timeout");
    expect(scrub("x".repeat(10) + " " + "y".repeat(400), 50)).toHaveLength(50);
    expect(scrub(undefined)).toBe("");
  });
});

describe("storedPathOrNull", () => {
  it("keeps a stored path and refuses the photo itself", () => {
    expect(storedPathOrNull("data/runtime/evidence/abc-annotated.jpg")).toBe("data/runtime/evidence/abc-annotated.jpg");
    expect(storedPathOrNull("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(storedPathOrNull("  ")).toBeNull();
    expect(storedPathOrNull(null)).toBeNull();
  });
});

describe("summaries", () => {
  it("shows the order without the customer's name, e-mail or address", () => {
    const summary = summarizeOrder(makeOrder());
    expect(summary).toMatchObject({ orderId: "#1001", carrier: "colissimo", items: ["Ceramic vase"], total: 59 });
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/Ada Lovelace|ada@example|Lyon|6A00000000001/);
  });

  it("counts the regions and keeps the stored path, never the image", () => {
    const stored = summarizeMarkDamage(0, ["broken pottery"], {
      photo: "data/runtime/uploads/p/photo-1.png",
      annotatedPhoto: "data/runtime/evidence/x-annotated.jpg",
      method: "sam-3.1",
      note: "SAM 3.1 outlined 3 regions matching \"broken pottery\".",
      regions: 3,
    });
    expect(stored).toMatchObject({ tool: "mark_damage", regions: 3, annotatedPath: "data/runtime/evidence/x-annotated.jpg" });

    const inline = summarizeMarkDamage(1, [], {
      photo: "data:image/png;base64,AAAA",
      annotatedPhoto: "data:image/png;base64,BBBB",
      method: "sam-3.1",
      note: "outlined",
      regions: 2,
    });
    expect(inline).toMatchObject({ annotatedPath: null });
    expect(JSON.stringify(inline)).not.toContain("BBBB");

    const none = summarizeMarkDamage(0, ["torn cardboard"], { photo: "p", annotatedPhoto: null, method: "none", note: "Raw photo." });
    expect(none).toMatchObject({ method: "none", regions: 0, annotatedPath: null });
  });
});

describe("reading an NDJSON stream", () => {
  const stream = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });

  async function collect(chunks: string[]) {
    const out = [];
    for await (const e of readStreamEvents(stream(chunks))) out.push(e);
    return out;
  }

  it("parses one event per line, whatever the chunking", async () => {
    const a = JSON.stringify({ type: "accepted", t: 0 });
    const b = JSON.stringify({ type: "ping", t: 5 });
    // A line split in two chunks, a chunk with two lines, and a last line with no newline.
    const events = await collect([`${a.slice(0, 10)}`, `${a.slice(10)}\n${b}\n`, JSON.stringify({ type: "done", t: 9 })]);
    expect(events.map((e) => e.type)).toEqual(["accepted", "ping", "done"]);
  });

  it("splits a multi-byte character cut between two chunks without breaking the line", async () => {
    const line = `${JSON.stringify({ type: "notice", t: 1, code: "agent_error", message: "café ☕" })}\n`;
    const bytes = new TextEncoder().encode(line);
    const cut = bytes.indexOf(0xe2) + 1; // inside the 3 bytes of the cup
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, cut));
        c.enqueue(bytes.slice(cut));
        c.close();
      },
    });
    const out = [];
    for await (const e of readStreamEvents(s)) out.push(e);
    expect(out).toHaveLength(1);
    expect((out[0] as { message: string }).message).toBe("café ☕");
  });

  it("skips blank, broken and untyped lines instead of failing", async () => {
    const events = await collect(["\n", "not json\n", '{"no":"type"}\n', '{"type":"ping","t":1}\n', "[1,2]\n"]);
    expect(events).toEqual([{ type: "ping", t: 1 }]);
    expect(parseStreamLine('{"type":3}')).toBeNull();
  });
});

describe("scrub keeps identifiers", () => {
  it("leaves a long snake_case name alone and still drops a key with digits", () => {
    expect(scrub("draft_claim_document failed")).toBe("draft_claim_document failed");
    expect(scrub("key sk-live-abcdefghijklmnop1234 leaked")).toBe("key [token] leaked");
  });
});
