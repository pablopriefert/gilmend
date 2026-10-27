import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { META_API_BASE_URL, MUSE_SPARK_MODEL } from "../config";
import { getProvider } from "./index";

const ROOT = path.resolve(__dirname, "../../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|py|md|json)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

afterEach(() => vi.restoreAllMocks());

/** A fetch stand-in that records the request and answers like a chat-completions server. */
function okFetch() {
  return vi.fn(
    async (url: string | URL | Request, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "m",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok", refusal: null } }],
        }),
        { status: 200, headers: { "content-type": "application/json", "x-test-url": String(url), "x-test-init": init ? "1" : "0" } },
      ),
  );
}

describe("getProvider", () => {
  it("builds the Meta provider with the Standard model id and the Meta base URL", () => {
    const p = getProvider("muse-spark-1.3", { MODEL_API_KEY: "placeholder-not-a-key" });
    expect(p).toMatchObject({ engine: "muse-spark-1.3", model: "muse-spark-1.3", isMock: false });
    expect(MUSE_SPARK_MODEL).toBe("muse-spark-1.3");
    expect(META_API_BASE_URL).toBe("https://api.meta.ai/v1");
  });

  it("calls the Meta endpoint with Bearer auth, the Standard model, tools, and no sampling override", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const p = getProvider("muse-spark-1.3", { MODEL_API_KEY: "placeholder-not-a-key" });
      await p.chat({ messages: [{ role: "user", content: "hi" }] });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://api.meta.ai/v1/chat/completions");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer placeholder-not-a-key");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("muse-spark-1.3");
      expect(body.stream).toBe(false);
      expect(body).not.toHaveProperty("temperature");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses to build a Meta provider without a key (the mock is chosen by resolveEngine, not here)", () => {
    expect(() => getProvider("muse-spark-1.3", {})).toThrow(/MODEL_API_KEY/);
  });

  it("builds the open-weights provider from its three variables", () => {
    const p = getProvider("open-weights", {
      OPEN_WEIGHTS_BASE_URL: "https://example.invalid/v1",
      OPEN_WEIGHTS_MODEL: "muse-glimmer",
    });
    expect(p).toMatchObject({ engine: "open-weights", model: "muse-glimmer", isMock: false });
    expect(() => getProvider("open-weights", { OPEN_WEIGHTS_MODEL: "muse-glimmer" })).toThrow(/OPEN_WEIGHTS_BASE_URL/);
  });

  it("applies Glimmer's published sampling and the reasoning-strength line on the open-weights engine", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const p = getProvider("open-weights", {
        OPEN_WEIGHTS_BASE_URL: "https://example.invalid/v1",
        OPEN_WEIGHTS_MODEL: "muse-glimmer",
        OPEN_WEIGHTS_REASONING_STRENGTH: "high",
      });
      await p.chat({ messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }] });
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body).toMatchObject({ model: "muse-glimmer", temperature: 1, top_p: 0.95, top_k: 64 });
      expect(body.messages[0].content).toBe("Be brief.\n\nReasoning strength: high");
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer EMPTY");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses a Contributor model id on every real engine", () => {
    expect(() =>
      getProvider("open-weights", {
        OPEN_WEIGHTS_BASE_URL: "https://example.invalid/v1",
        OPEN_WEIGHTS_MODEL: "muse-spark-1.3-contributor",
      }),
    ).toThrow(/Contributor/);
  });

  it("the mock is labelled as a mock and never claims to be Muse", () => {
    const p = getProvider("demo-mock");
    expect(p).toMatchObject({ engine: "demo-mock", model: "demo-mock", isMock: true });
    expect(p.model).not.toMatch(/muse/i);
  });
});

describe("no Contributor model id anywhere in the provider and agent code", () => {
  const files = [
    ...sourceFiles(path.join(ROOT, "src/lib/providers")),
    ...sourceFiles(path.join(ROOT, "src/lib/agent")),
    path.join(ROOT, "src/lib/config.ts"),
    path.join(ROOT, "deploy/modal_glimmer.py"),
    path.join(ROOT, ".env.example"),
  ];

  it("scans a non-trivial set of files", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it("never writes a model id that ends in -contributor", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      // An id looks like muse-...-contributor. Prose and the refusal regex in config.ts
      // mention the word, but never as part of a model id string.
      const ids = text.match(/["'`][\w./-]*muse[\w./-]*contributor[\w./-]*["'`]/gi) ?? [];
      expect(ids, `${path.relative(ROOT, f)} contains a contributor model id`).toEqual([]);
    }
  });

  it("only ever passes MUSE_SPARK_MODEL as the Meta model id", () => {
    const src = readFileSync(path.join(ROOT, "src/lib/providers/index.ts"), "utf8");
    expect(src).toContain("assertStandardModel(MUSE_SPARK_MODEL)");
  });
});

describe("open-weights server behind Modal proxy auth", () => {
  const env = {
    OPEN_WEIGHTS_BASE_URL: "https://ws--damage-desk-glimmer-glimmer-serve.modal.run/v1",
    OPEN_WEIGHTS_MODEL: "muse-glimmer",
    OPEN_WEIGHTS_API_KEY: "vllm-key-placeholder",
  };
  const headersSent = async (extra: Record<string, string>) => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await getProvider("open-weights", { ...env, ...extra }).chat({ messages: [{ role: "user", content: "hi" }] });
      return new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it("sends Modal-Key and Modal-Secret next to the vLLM bearer key when both are configured", async () => {
    // vLLM's --api-key leaves /invocations open; Modal's proxy auth (requires_proxy_auth=True)
    // locks the whole URL, and answers 401 without this pair.
    const h = await headersSent({ OPEN_WEIGHTS_PROXY_KEY: "wk-test", OPEN_WEIGHTS_PROXY_SECRET: "ws-test" });
    expect(h.get("modal-key")).toBe("wk-test");
    expect(h.get("modal-secret")).toBe("ws-test");
    expect(h.get("authorization")).toBe("Bearer vllm-key-placeholder");
  });

  it("sends neither header when the pair is incomplete or absent", async () => {
    expect((await headersSent({})).get("modal-key")).toBeNull();
    const half = await headersSent({ OPEN_WEIGHTS_PROXY_KEY: "wk-test" });
    expect(half.get("modal-key")).toBeNull();
    expect(half.get("modal-secret")).toBeNull();
  });

  it("never sends the proxy headers to the Meta Model API", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await getProvider("muse-spark-1.3", {
        MODEL_API_KEY: "placeholder-not-a-key",
        OPEN_WEIGHTS_PROXY_KEY: "wk-test",
        OPEN_WEIGHTS_PROXY_SECRET: "ws-test",
      }).chat({ messages: [{ role: "user", content: "hi" }] });
      const h = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
      expect(h.get("modal-key")).toBeNull();
      expect(h.get("modal-secret")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the deploy script for the open-weights server", () => {
  it("publishes the server behind Modal proxy auth, because vLLM --api-key leaves /invocations open", () => {
    const script = readFileSync(path.join(ROOT, "deploy", "modal_glimmer.py"), "utf8");
    expect(script).toMatch(/@modal\.web_server\([^)]*requires_proxy_auth=True/);
  });
});

describe("open-weights on Baseten", () => {
  const env = {
    OPEN_WEIGHTS_PROVIDER: "baseten",
    BASETEN_API_KEY: "placeholder-not-a-key",
    // The generic variables must be ignored when the Baseten preset is chosen.
    OPEN_WEIGHTS_BASE_URL: "https://ignored.invalid/v1",
    OPEN_WEIGHTS_PROXY_KEY: "wk-test",
    OPEN_WEIGHTS_PROXY_SECRET: "ws-test",
  };
  const send = async (extra: Record<string, string> = {}, params: Partial<Parameters<ReturnType<typeof getProvider>["chat"]>[0]> = {}) => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const p = getProvider("open-weights", { ...env, ...extra });
      await p.chat({ messages: [{ role: "user", content: "hi" }], ...params });
      const [url, init] = fetchMock.mock.calls[0];
      return {
        p,
        url: String(url),
        headers: new Headers((init as RequestInit).headers),
        body: JSON.parse(String((init as RequestInit).body)),
      };
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it("calls Baseten's chat-completions endpoint with the Baseten key and the guide's Muse Spark Open slug", async () => {
    const { p, url, headers, body } = await send();
    expect(url).toBe("https://inference.baseten.co/v1/chat/completions");
    expect(headers.get("authorization")).toBe("Bearer placeholder-not-a-key");
    expect(body.model).toBe("meta-models/muse-spark-open-1026");
    expect(p).toMatchObject({ engine: "open-weights", isMock: false, supportsImages: true });
    expect(p.detail).toMatchObject({ host: "baseten", label: "Muse Spark Open (open weights, served by Baseten)" });
  });

  it("sends the sampling of the model card, a reasoning effort, and neither Modal headers nor top_k", async () => {
    const { headers, body } = await send();
    expect(body).toMatchObject({ temperature: 1, top_p: 1, reasoning_effort: "medium", stream: false });
    expect(body).not.toHaveProperty("top_k");
    expect(headers.get("modal-key")).toBeNull();
    expect(headers.get("modal-secret")).toBeNull();
    // Glimmer's system-prompt line does not apply here: the field above does the job.
    expect(JSON.stringify(body.messages)).not.toMatch(/Reasoning strength/);
  });

  it("takes the reasoning effort from OPEN_WEIGHTS_REASONING_STRENGTH and ignores values Baseten does not know", async () => {
    expect((await send({ OPEN_WEIGHTS_REASONING_STRENGTH: "xhigh" })).body.reasoning_effort).toBe("xhigh");
    expect((await send({ OPEN_WEIGHTS_REASONING_STRENGTH: "max" })).body.reasoning_effort).toBe("medium");
  });

  it("uses a random session-affinity header that carries nothing about the case, new for each provider", async () => {
    const a = (await send()).headers.get("x-session-affinity");
    const b = (await send()).headers.get("x-session-affinity");
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it("passes tools and image_url parts through untouched (no response_format: Baseten does not support it for this model)", async () => {
    const tools = [{ type: "function" as const, function: { name: "t", parameters: { type: "object", properties: {} } } }];
    const content = [
      { type: "text" as const, text: "look" },
      { type: "image_url" as const, image_url: { url: "data:image/png;base64,AAAA" } },
    ];
    const { body } = await send({}, { tools, messages: [{ role: "user", content }] });
    expect(body.tools).toEqual(tools);
    expect(body.messages[0].content).toEqual(content);
    expect(body).not.toHaveProperty("response_format");
  });

  it("honours BASETEN_MODEL and OPEN_WEIGHTS_VISION=0", async () => {
    const { p, body } = await send({ BASETEN_MODEL: "meta-models/muse-spark-open", OPEN_WEIGHTS_VISION: "0" });
    expect(body.model).toBe("meta-models/muse-spark-open");
    expect(p.supportsImages).toBe(false);
  });

  it("refuses to build without the Baseten key, and says which variable is missing", () => {
    expect(() => getProvider("open-weights", { OPEN_WEIGHTS_PROVIDER: "baseten" })).toThrow(/BASETEN_API_KEY/);
  });

  it("refuses a Contributor slug even from BASETEN_MODEL", () => {
    expect(() => getProvider("open-weights", { ...env, BASETEN_MODEL: "meta-models/muse-spark-open-contributor" })).toThrow(
      /Contributor/,
    );
  });
});

describe("the generic open-weights path keeps its labels", () => {
  it("names Muse Glimmer on Modal on the provider, and keeps images on by default", () => {
    const p = getProvider("open-weights", {
      OPEN_WEIGHTS_BASE_URL: "https://ws--damage-desk-glimmer-glimmer-serve.modal.run/v1",
      OPEN_WEIGHTS_MODEL: "muse-glimmer",
    });
    expect(p.detail).toMatchObject({ host: "modal", label: "Muse Glimmer (open weights, served by Modal)" });
    expect(p.supportsImages).toBe(true);
  });
});

describe("the OpenRouter test engine", () => {
  const env = { OPENROUTER_API_KEY: "placeholder-not-a-key" };
  const send = async (extra: Record<string, string> = {}) => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const p = getProvider("openrouter", { ...env, ...extra, OPEN_WEIGHTS_PROXY_KEY: "wk-test", OPEN_WEIGHTS_PROXY_SECRET: "ws-test" });
      await p.chat({ messages: [{ role: "user", content: "hi" }] });
      const [url, init] = fetchMock.mock.calls[0];
      return {
        p,
        url: String(url),
        headers: new Headers((init as RequestInit).headers),
        body: JSON.parse(String((init as RequestInit).body)),
      };
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it("calls OpenRouter with its own key and the Standard Muse Spark 1.3 id", async () => {
    const { p, url, headers, body } = await send();
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(headers.get("authorization")).toBe("Bearer placeholder-not-a-key");
    expect(body.model).toBe("meta/muse-spark-1.3");
    expect(headers.get("modal-key")).toBeNull();
    expect(p).toMatchObject({ engine: "openrouter", isMock: false });
    expect(p.detail?.label).toBe("Muse Spark 1.3 via OpenRouter (test engine, not private)");
  });

  it("only routes to endpoints that do not store prompts or train on them", async () => {
    expect((await send()).body.provider).toEqual({ data_collection: "deny" });
  });

  it("refuses to build without its key and refuses a Contributor id", () => {
    expect(() => getProvider("openrouter", {})).toThrow(/OPENROUTER_API_KEY/);
    expect(() => getProvider("openrouter", { ...env, OPENROUTER_MODEL: "meta/muse-spark-1.3-contributor" })).toThrow(
      /Contributor/,
    );
  });
});
