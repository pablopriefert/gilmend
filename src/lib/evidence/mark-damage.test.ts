import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { damageConceptFor, itemConcept, markDamage } from "./mark-damage";
import { IMAGE_H, IMAGE_W, samLine, sseResponse, writeGreyPhoto } from "./test-helpers";

let dir: string;
let photo: string;
const KEY = { MODEL_API_KEY: "test-key-not-real" };

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "damage-desk-evidence-"));
  photo = await writeGreyPhoto(dir);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const run = (fetchImpl: typeof fetch, extra = {}) =>
  markDamage(photo, { env: KEY, fetchImpl, runtimeDir: dir, quiet: true, ...extra });

describe("markDamage without a key (demo mode)", () => {
  it("returns method 'none' with a note, never a fake outline, and makes no call", async () => {
    const fetchImpl = vi.fn();
    const evidence = await markDamage(photo, {
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runtimeDir: dir,
      quiet: true,
    });
    expect(evidence).toEqual({
      photo,
      annotatedPhoto: null,
      method: "none",
      note: expect.stringContaining("MODEL_API_KEY is not set"),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a blank key as missing", async () => {
    const evidence = await markDamage(photo, { env: { MODEL_API_KEY: "   " }, runtimeDir: dir, quiet: true });
    expect(evidence.method).toBe("none");
  });

  it("logs that nothing was segmented", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await markDamage(photo, { env: {}, runtimeDir: dir });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no SAM annotation"));
    warn.mockRestore();
  });
});

describe("markDamage and the engine of the case", () => {
  // SAM runs on the Meta Model API. "Run privately" promises that nothing goes there, and a
  // DEMO MODE case must neither spend credits nor claim a SAM annotation.
  for (const [engine, wording] of [
    ["open-weights", /private run/],
    ["openrouter", /OpenRouter test engine/],
    ["demo-mock", /DEMO MODE/],
  ] as const) {
    it(`does not call SAM for a ${engine} case, even when a key is configured`, async () => {
      const fetchImpl = vi.fn();
      const evidence = await markDamage(photo, {
        engine,
        env: KEY,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runtimeDir: dir,
        quiet: true,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(evidence).toMatchObject({ method: "none", annotatedPhoto: null, note: expect.stringMatching(wording) });
    });
  }

  it("calls SAM for a Muse Spark case", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([samLine(0.9)]));
    const evidence = await run(fetchImpl as unknown as typeof fetch, { engine: "muse-spark-1.3" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(evidence.method).toBe("sam-3.1");
  });

  it("tries the model's concepts in order, one per request", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string).input[0].content[0].text);
      return bodies.length === 2 ? sseResponse([samLine(0.9)]) : sseResponse([]);
    });
    await run(fetchImpl as unknown as typeof fetch, { concepts: ["shattered vase", "crack", "dent"] });
    expect(bodies).toEqual(["shattered vase", "crack"]);
  });
});

describe("markDamage request shape", () => {
  it("posts one concept and one image to /responses with the Bearer key", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([samLine(0.9)]));
    await run(fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.meta.ai/v1/responses");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key-not-real");
    expect(headers.Accept).toBe("text/event-stream");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("sam-3.1");
    expect(body.model).not.toMatch(/contributor/i);
    expect(body.stream).toBe(true);
    // metadata values are strings in this API
    expect(body.metadata).toEqual({ mask_encoding: "one_bit", include_confidence: "true" });
    expect(body.input).toHaveLength(1);
    const [message] = body.input;
    expect(message).toMatchObject({ type: "message", role: "user" });
    expect(message.content[0]).toEqual({ type: "input_text", text: "torn cardboard" });
    expect(message.content[1].type).toBe("input_image");
    expect(message.content[1].image_url).toMatch(/^data:image\/jpeg;base64,/);
    // The key must never travel in the body.
    expect(init.body as string).not.toContain("test-key-not-real");
  });

  it("honours SAM_BASE_URL, then MODEL_BASE_URL", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return sseResponse([]);
    }) as unknown as typeof fetch;
    await run(fetchImpl, { env: { ...KEY, SAM_BASE_URL: "https://sam.example/v1/" }, concepts: ["crack"] });
    await run(fetchImpl, { env: { ...KEY, MODEL_BASE_URL: "https://model.example/v1" }, concepts: ["crack"] });
    expect(urls).toEqual(["https://sam.example/v1/responses", "https://model.example/v1/responses"]);
  });

  it("uses the concepts it is given, in order, and stops at the first match", async () => {
    const concepts: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const concept = JSON.parse(init.body as string).input[0].content[0].text as string;
      concepts.push(concept);
      return concept === "dent" ? sseResponse([samLine(0.8)]) : sseResponse([]);
    }) as unknown as typeof fetch;
    const evidence = await run(fetchImpl, { concepts: ["torn cardboard", "dent", "crack"] });
    expect(concepts).toEqual(["torn cardboard", "dent"]);
    expect(evidence.method).toBe("sam-3.1");
    expect(evidence.note).toContain('"dent"');
  });
});

describe("markDamage with a SAM answer", () => {
  it("draws the outline on the photo and returns the annotated path", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([samLine(0.91)])) as unknown as typeof fetch;
    const evidence = await run(fetchImpl);

    expect(evidence.method).toBe("sam-3.1");
    expect(evidence.photo).toBe(photo);
    expect(evidence.note).toContain("confidence 0.91");
    expect(evidence.annotatedPhoto).toMatch(/evidence[\\/][0-9a-f]{16}-annotated\.jpg$/);
    const file = path.resolve(evidence.annotatedPhoto!);
    await expect(stat(file)).resolves.toBeTruthy();

    const { data, info } = await sharp(await readFile(file)).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([IMAGE_W, IMAGE_H]);
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    };
    // Outside the box: untouched grey.
    const [r0, g0, b0] = px(20, 20);
    expect(Math.abs(r0 - 136)).toBeLessThan(6);
    expect(Math.abs(g0 - 136)).toBeLessThan(6);
    expect(Math.abs(b0 - 136)).toBeLessThan(6);
    // Box frame (amber), top-left corner of the box.
    const [rf, gf, bf] = px(100, 80);
    expect(rf).toBeGreaterThan(200);
    expect(gf).toBeGreaterThan(110);
    expect(bf).toBeLessThan(90);
    // Inside the ellipse: tinted rose (red up, green down).
    const [rm, gm] = px(160, 120);
    expect(rm - gm).toBeGreaterThan(40);
    // Inside the box but outside the ellipse (corner region): not tinted.
    const [rc, gc] = px(105, 85);
    expect(Math.abs(rc - gc)).toBeLessThan(10);
  });

  it("accepts a data URL photo", async () => {
    const dataUrl = `data:image/jpeg;base64,${(await readFile(photo)).toString("base64")}`;
    const fetchImpl = vi.fn(async () => sseResponse([samLine(0.9)])) as unknown as typeof fetch;
    const evidence = await markDamage(dataUrl, { env: KEY, fetchImpl, runtimeDir: dir, quiet: true });
    expect(evidence.method).toBe("sam-3.1");
    expect(evidence.photo).toBe(dataUrl);
  });

  it("works when the stream skips the output_text.done event", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([samLine(0.9)], { withDone: false })) as unknown as typeof fetch;
    expect((await run(fetchImpl)).method).toBe("sam-3.1");
  });

  it("works when the server answers with one JSON body instead of a stream", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: samLine(0.7) }] }] }), {
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    expect((await run(fetchImpl)).method).toBe("sam-3.1");
  });

  it("works without a confidence field", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([samLine()])) as unknown as typeof fetch;
    const evidence = await run(fetchImpl);
    expect(evidence.method).toBe("sam-3.1");
    expect(evidence.note).not.toContain("confidence");
  });
});

describe("markDamage falls back cleanly", () => {
  const expectFallback = (evidence: Awaited<ReturnType<typeof markDamage>>) => {
    expect(evidence.method).toBe("none");
    expect(evidence.annotatedPhoto).toBeNull();
    expect(evidence.photo).toBe(photo);
  };

  it("when SAM finds nothing for any concept", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([]));
    const evidence = await run(fetchImpl as unknown as typeof fetch);
    expectFallback(evidence);
    expect(evidence.note).toContain("found no region");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // "crack" then "dent"
  });

  it("when the only regions are below the confidence floor", async () => {
    const fetchImpl = vi.fn(async () => sseResponse([samLine(0.1)])) as unknown as typeof fetch;
    expectFallback(await run(fetchImpl));
  });

  it("on an HTTP error, without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const evidence = await run(fetchImpl);
    expectFallback(evidence);
    expect(evidence.note).toContain("HTTP 401");
    expect(evidence.note).not.toContain("test-key-not-real");
  });

  it("on a network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const evidence = await run(fetchImpl);
    expectFallback(evidence);
    expect(evidence.note).toContain("fetch failed");
  });

  it("on a timeout", async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    expectFallback(await run(fetchImpl, { timeoutMs: 20 }));
  });

  it("on a stream that ends before completion", async () => {
    const truncated = new Response(
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "<0f>", item_id: "m", output_index: 0, content_index: 0 })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
    const fetchImpl = vi.fn(async () => truncated) as unknown as typeof fetch;
    expectFallback(await run(fetchImpl));
  });

  it("on garbage output", async () => {
    const fetchImpl = vi.fn(async () => sseResponse(["not a segmentation line"])) as unknown as typeof fetch;
    expectFallback(await run(fetchImpl));
  });

  it("when the photo does not exist", async () => {
    const fetchImpl = vi.fn();
    const evidence = await markDamage(path.join(dir, "missing.jpg"), {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runtimeDir: dir,
      quiet: true,
    });
    expect(evidence.method).toBe("none");
    expect(evidence.note).toContain("not found");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("when the file is not an image", async () => {
    const bad = path.join(dir, "notes.jpg");
    await (await import("node:fs/promises")).writeFile(bad, "just text");
    const fetchImpl = vi.fn();
    const evidence = await markDamage(bad, {
      env: KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      runtimeDir: dir,
      quiet: true,
    });
    expect(evidence.method).toBe("none");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses remote URLs and paths outside the allowed folders", async () => {
    const fetchImpl = vi.fn();
    for (const ref of ["https://example.com/p.jpg", "/etc/passwd", "../../../../etc/passwd"]) {
      const evidence = await markDamage(ref, {
        env: KEY,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runtimeDir: dir,
        quiet: true,
      });
      expect(evidence.method).toBe("none");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("damageConceptFor", () => {
  it("maps the assessment to a short SAM noun phrase, or null when nothing can be outlined", () => {
    const base = {
      item: "Glass carafe, 1 L",
      severity: "major" as const,
      carrierLikelyAtFault: true,
      packagingAdequate: true,
      evidenceNotes: [],
      photoQuality: "ok" as const,
    };
    // SAM outlines objects, not cracks: a broken product is outlined as the product itself.
    expect(damageConceptFor({ ...base, damageType: "broken_product" })).toBe("glass carafe");
    expect(damageConceptFor({ ...base, damageType: "crushed_packaging" })).toBe("torn cardboard");
    expect(damageConceptFor({ ...base, damageType: "opened_parcel" })).toBe("torn cardboard");
    expect(damageConceptFor({ ...base, damageType: "missing_item" })).toBeNull();
    expect(damageConceptFor({ ...base, damageType: "unclear" })).toBeNull();
    expect(damageConceptFor(null)).toBeNull();
  });
});

describe("itemConcept", () => {
  it("turns the item of the assessment into a SAM noun phrase", () => {
    expect(itemConcept("Glass carafe, 1 L")).toBe("glass carafe");
    expect(itemConcept("Handmade blue ceramic vase (large)")).toBe("blue ceramic vase");
    expect(itemConcept("Wireless headphones - black")).toBe("wireless headphones");
  });

  it("returns null when nothing usable is left", () => {
    expect(itemConcept(undefined)).toBeNull();
    expect(itemConcept("")).toBeNull();
    expect(itemConcept("x")).toBeNull();
    expect(itemConcept("123 456")).toBeNull();
  });
});
