import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { damageConceptFor, damageConceptsFor, itemConcept, markDamage, materialConcept } from "./mark-damage";
import { IMAGE_H, IMAGE_W, fakeSam, samLine, samRegions, sseResponse, writeGreyPhoto } from "./test-helpers";

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
    ["openrouter", /OpenRouter test engine.*photos still go to OpenRouter/],
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

  it("asks the model's concepts in order, one per request, until one gives strong regions", async () => {
    const asked: string[] = [];
    const strong = samRegions([{ confidence: 0.9, at: { x: 0, y: 0 } }, { confidence: 0.8, at: { x: 200, y: 100 } }]);
    const fetchImpl = fakeSam({ crack: strong }, asked);
    await run(fetchImpl, { concepts: ["shattered vase", "crack", "dent"] });
    expect(asked).toEqual(["shattered vase", "crack"]);
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
    await run(fetchImpl, { env: { ...KEY, SAM_BASE_URL: "https://sam.example/v1/" }, concepts: ["crack"], fallbackConcepts: [] });
    await run(fetchImpl, { env: { ...KEY, MODEL_BASE_URL: "https://model.example/v1" }, concepts: ["crack"], fallbackConcepts: [] });
    expect(urls).toEqual(["https://sam.example/v1/responses", "https://model.example/v1/responses"]);
  });

  it("uses the concepts it is given, in order, and lists the one that matched", async () => {
    const asked: string[] = [];
    const fetchImpl = fakeSam({ dent: [samLine(0.8)] }, asked);
    const evidence = await run(fetchImpl, { concepts: ["torn cardboard", "dent"] });
    expect(asked).toEqual(["torn cardboard", "dent"]);
    expect(evidence.method).toBe("sam-3.1");
    expect(evidence.note).toContain('matching "dent"');
    expect(evidence.note).toContain('No region for "torn cardboard"');
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

describe("markDamage merges the concepts of the damaged item", () => {
  const shards = (n: number, confidence = 0.85) =>
    samRegions(
      Array.from({ length: n }, (_, i) => ({
        confidence: confidence - i * 0.01,
        at: { x: (i % 3) * 130, y: Math.floor(i / 3) * 100 },
      })),
    );
  // The whole-vase box of the single-region answer sits where no shard is.
  const vaseNeck = samLine(0.68, { x: 270, y: 200 });

  it("keeps the shards of the second concept next to the lone region of the model's concept", async () => {
    // The 27 Oct 2026 case 1: "ceramic vase" gave one weak region, "broken pottery" 26 shards.
    const asked: string[] = [];
    const fetchImpl = fakeSam({ "ceramic vase": [vaseNeck], "broken pottery": shards(4) }, asked);
    const evidence = await run(fetchImpl, { concepts: ["ceramic vase", "broken pottery"] });
    expect(asked).toEqual(["ceramic vase", "broken pottery"]);
    expect(evidence.method).toBe("sam-3.1");
    expect(evidence.note).toContain("outlined 5 regions");
    expect(evidence.note).toContain('from 2 concepts: "ceramic vase" 1, "broken pottery" 4');
    expect(evidence.note).toContain("confidence 0.85, 0.84, 0.83, 0.82, 0.68");
  });

  it("keeps at most 5 regions, the most confident", async () => {
    const fetchImpl = fakeSam({ "ceramic vase": [vaseNeck], "broken pottery": shards(6) });
    const evidence = await run(fetchImpl, { concepts: ["ceramic vase", "broken pottery"] });
    expect(evidence.note).toContain("outlined 5 regions");
    // The lone 0.68 region loses to five shards at 0.80 and above, so its concept drops out.
    expect(evidence.note).toContain('matching "broken pottery"');
    expect(evidence.note).not.toContain("0.68");
    expect(evidence.note).toContain('Also matched "ceramic vase"');
  });

  it("stops when one concept already gave strong regions: no third call", async () => {
    const asked: string[] = [];
    const fetchImpl = fakeSam({ "ear cup": shards(2, 0.88), headphones: [samLine(0.98)] }, asked);
    const evidence = await run(fetchImpl, { concepts: ["ear cup", "headphones"] });
    expect(asked).toEqual(["ear cup"]);
    expect(evidence.note).toContain('matching "ear cup"');
  });

  it("does not stop on a single region, even a confident one", async () => {
    const asked: string[] = [];
    const fetchImpl = fakeSam({ "glass carafe": [samLine(0.9)], "glass water carafe": [] }, asked);
    const evidence = await run(fetchImpl, { concepts: ["glass carafe", "glass water carafe"] });
    expect(asked).toEqual(["glass carafe", "glass water carafe"]);
    expect(evidence.note).toContain('matching "glass carafe" (confidence 0.90)');
    expect(evidence.note).toContain('No region for "glass water carafe"');
  });

  it("drops a region that overlaps one already kept (IoU above 0.5) and credits the more confident concept", async () => {
    // Same box from two concepts: one region, credited to the 0.9 one.
    const fetchImpl = fakeSam({ "ceramic vase": [samLine(0.6)], "broken pottery": [samLine(0.9)] });
    const evidence = await run(fetchImpl, { concepts: ["ceramic vase", "broken pottery"] });
    expect(evidence.note).toContain("outlined 1 region matching \"broken pottery\" (confidence 0.90)");
    expect(evidence.note).toContain('Also matched "ceramic vase"');
    expect(evidence.note).not.toContain("No region for");
  });

  it("makes at most 3 SAM calls per photo, whatever the lists hold", async () => {
    const asked: string[] = [];
    const evidence = await run(fakeSam({}, asked), {
      concepts: ["a", "b", "c", "d"],
      fallbackConcepts: ["torn cardboard", "cardboard box"],
    });
    expect(asked).toEqual(["a", "b", "c"]);
    expect(evidence.method).toBe("none");
    expect(evidence.note).toContain('"a", "b", "c"');
  });

  it("asks a concept once even when two lists name it", async () => {
    const asked: string[] = [];
    await run(fakeSam({}, asked), { concepts: ["glass carafe", "glass carafe"], fallbackConcepts: ["glass carafe", "torn cardboard"] });
    expect(asked).toEqual(["glass carafe", "torn cardboard"]);
  });

  it("asks the packaging only when nothing about the item matched", async () => {
    const asked: string[] = [];
    const none = fakeSam({ "torn cardboard": [samLine(0.7)] }, asked);
    const evidence = await run(none, { concepts: ["ceramic vase", "broken pottery"], fallbackConcepts: ["torn cardboard", "cardboard box"] });
    expect(asked).toEqual(["ceramic vase", "broken pottery", "torn cardboard"]);
    expect(evidence.note).toContain('matching "torn cardboard"');

    // A weak match on the item is enough to leave the packaging alone.
    const askedWeak: string[] = [];
    const weak = fakeSam({ "ceramic vase": [samLine(0.5)] }, askedWeak);
    await run(weak, { concepts: ["ceramic vase", "broken pottery"], fallbackConcepts: ["torn cardboard", "cardboard box"] });
    expect(askedWeak).toEqual(["ceramic vase", "broken pottery"]);
  });

  it("stops at the first packaging concept that matches", async () => {
    const asked: string[] = [];
    await run(fakeSam({ "torn cardboard": [samLine(0.7)] }, asked), { concepts: [] });
    expect(asked).toEqual(["torn cardboard"]);
  });

  it("keeps what an earlier call found when a later one fails, and says so", async () => {
    const fetchImpl = fakeSam({ "ceramic vase": [samLine(0.7)], "broken pottery": new Response("down", { status: 503 }) });
    const evidence = await run(fetchImpl, { concepts: ["ceramic vase", "broken pottery"] });
    expect(evidence.method).toBe("sam-3.1");
    expect(evidence.note).toContain("A later SAM call failed (SAM request failed with HTTP 503");
    expect(evidence.note).toContain("may be incomplete");
  });

  it("falls back to the raw photo when the first call fails", async () => {
    const fetchImpl = fakeSam({ "ceramic vase": new Error("fetch failed") });
    const evidence = await run(fetchImpl, { concepts: ["ceramic vase", "broken pottery"] });
    expect(evidence.method).toBe("none");
    expect(evidence.note).toContain("fetch failed");
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

describe("materialConcept and damageConceptsFor", () => {
  const assessment = (item: string, damageType: "broken_product" | "crushed_packaging" | "missing_item") => ({
    item,
    damageType,
    severity: "major" as const,
    carrierLikelyAtFault: true,
    packagingAdequate: true,
    evidenceNotes: [],
    photoQuality: "ok" as const,
  });

  it("derives 'broken pottery' from a ceramic item, and nothing for glass or an unnamed material", () => {
    expect(materialConcept("White ceramic vase")).toBe("broken pottery");
    expect(materialConcept("porcelain teapot")).toBe("broken pottery");
    expect(materialConcept("Stoneware mug, set of 2")).toBe("broken pottery");
    // "broken glass" matched nothing on the carafe photo (27 Oct 2026): not offered.
    expect(materialConcept("Glass carafe, 1 L")).toBeNull();
    expect(materialConcept("Studio wireless headphones")).toBeNull();
    expect(materialConcept(undefined)).toBeNull();
  });

  it("asks the model's concept and the broken material of the item, packaging last", () => {
    expect(damageConceptsFor("ceramic vase", assessment("White ceramic vase", "broken_product"))).toEqual({
      concepts: ["ceramic vase", "broken pottery"],
      fallbackConcepts: ["torn cardboard", "cardboard box"],
    });
  });

  it("uses the item noun when no material concept exists, once when it equals the model's", () => {
    expect(damageConceptsFor("ear cup", assessment("Studio wireless headphones", "broken_product")).concepts).toEqual([
      "ear cup",
      "studio wireless headphones",
    ]);
    expect(damageConceptsFor("glass carafe", assessment("Glass carafe, 1 L", "broken_product")).concepts).toEqual([
      "glass carafe",
    ]);
  });

  it("works without a model concept or without an assessment", () => {
    expect(damageConceptsFor(null, assessment("White ceramic vase", "broken_product")).concepts).toEqual(["broken pottery"]);
    expect(damageConceptsFor("shards", null).concepts).toEqual(["shards"]);
    expect(damageConceptsFor(null, null).concepts).toEqual([]);
  });

  it("keeps the cardboard as the item concept of a crushed parcel, and no material for a missing item", () => {
    expect(damageConceptsFor("cardboard box", assessment("Framed print", "crushed_packaging")).concepts).toEqual([
      "cardboard box",
      "torn cardboard",
    ]);
    expect(damageConceptsFor(null, assessment("White ceramic vase", "missing_item")).concepts).toEqual([]);
  });
});

describe("itemConcept", () => {
  it("turns the item of the assessment into a SAM noun phrase", () => {
    expect(itemConcept("Glass carafe, 1 L")).toBe("glass carafe");
    expect(itemConcept("Handmade blue ceramic vase (large)")).toBe("blue ceramic vase");
    expect(itemConcept("Wireless headphones - black")).toBe("wireless headphones");
    // The size and its unit are not part of the noun phrase ("water carafe l" matched nothing).
    expect(itemConcept("glass water carafe 1L")).toBe("glass water carafe");
  });

  it("returns null when nothing usable is left", () => {
    expect(itemConcept(undefined)).toBeNull();
    expect(itemConcept("")).toBeNull();
    expect(itemConcept("x")).toBeNull();
    expect(itemConcept("123 456")).toBeNull();
  });
});
