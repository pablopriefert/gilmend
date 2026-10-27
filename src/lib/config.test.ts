import { describe, expect, it } from "vitest";
import {
  BASETEN_BASE_URL,
  BASETEN_MUSE_SPARK_OPEN_MODEL,
  MUSE_SPARK_MODEL,
  assertStandardModel,
  describeEngine,
  hasModelKey,
  hasOpenWeightsConfig,
  modelDisplayName,
  resolveEngine,
  resolveOpenWeights,
} from "./config";

describe("config", () => {
  it("uses the Standard Muse Spark model id", () => {
    expect(MUSE_SPARK_MODEL).toBe("muse-spark-1.3");
    expect(assertStandardModel(MUSE_SPARK_MODEL)).toBe("muse-spark-1.3");
  });

  it("refuses any contributor model id", () => {
    expect(() => assertStandardModel("muse-spark-1.3-contributor")).toThrow(/Contributor/);
    expect(() => assertStandardModel("Muse-Spark-Contributor")).toThrow();
  });

  it("falls back to demo-mock when no key is set", () => {
    expect(hasModelKey({})).toBe(false);
    expect(hasModelKey({ MODEL_API_KEY: "  " })).toBe(false);
    expect(resolveEngine("muse-spark-1.3", {})).toBe("demo-mock");
    expect(resolveEngine(undefined, {})).toBe("demo-mock");
  });

  it("picks Muse only when a key exists, and open weights only when configured", () => {
    const withKey = { MODEL_API_KEY: "placeholder" };
    expect(resolveEngine("muse-spark-1.3", withKey)).toBe("muse-spark-1.3");
    expect(resolveEngine("open-weights", withKey)).toBe("demo-mock");
    const ow = {
      OPEN_WEIGHTS_BASE_URL: "https://example.invalid/v1",
      OPEN_WEIGHTS_MODEL: "glimmer",
    };
    expect(resolveEngine("open-weights", ow)).toBe("open-weights");
    expect(resolveEngine("demo-mock", withKey)).toBe("demo-mock");
  });
});

const BASETEN_ENV = { OPEN_WEIGHTS_PROVIDER: "baseten", BASETEN_API_KEY: "placeholder-not-a-key" };

describe("open-weights on Baseten", () => {
  it("needs only the provider switch and the Baseten key, and defaults to Baseten's endpoint and the guide's slug", () => {
    expect(BASETEN_BASE_URL).toBe("https://inference.baseten.co/v1");
    expect(BASETEN_MUSE_SPARK_OPEN_MODEL).toBe("meta-models/muse-spark-open-1026");
    const setup = resolveOpenWeights(BASETEN_ENV);
    expect(setup).toMatchObject({
      host: "baseten",
      baseURL: BASETEN_BASE_URL,
      model: "meta-models/muse-spark-open-1026",
      apiKey: "placeholder-not-a-key",
      supportsImages: true,
    });
    expect(hasOpenWeightsConfig(BASETEN_ENV)).toBe(true);
    expect(resolveEngine("open-weights", BASETEN_ENV)).toBe("open-weights");
  });

  it("is not configured without the key, even if the generic variables are set (no silent change of host)", () => {
    const env = {
      OPEN_WEIGHTS_PROVIDER: "baseten",
      OPEN_WEIGHTS_BASE_URL: "https://example.invalid/v1",
      OPEN_WEIGHTS_MODEL: "muse-glimmer",
    };
    expect(resolveOpenWeights(env)).toBeNull();
    expect(resolveEngine("open-weights", env)).toBe("demo-mock");
  });

  it("does not turn on from a stray BASETEN_API_KEY alone", () => {
    expect(resolveOpenWeights({ BASETEN_API_KEY: "placeholder-not-a-key" })).toBeNull();
  });

  it("lets BASETEN_MODEL override the slug", () => {
    expect(resolveOpenWeights({ ...BASETEN_ENV, BASETEN_MODEL: "meta-models/muse-spark-open" })?.model).toBe(
      "meta-models/muse-spark-open",
    );
  });

  it("treats an unknown provider name as a typo, not as a reason to guess a host", () => {
    expect(
      resolveOpenWeights({
        OPEN_WEIGHTS_PROVIDER: "basten",
        OPEN_WEIGHTS_BASE_URL: "https://example.invalid/v1",
        OPEN_WEIGHTS_MODEL: "m",
      }),
    ).toBeNull();
  });

  it("can declare the model unable to read images", () => {
    expect(resolveOpenWeights({ ...BASETEN_ENV, OPEN_WEIGHTS_VISION: "0" })?.supportsImages).toBe(false);
    expect(resolveOpenWeights({ ...BASETEN_ENV, OPEN_WEIGHTS_VISION: "off" })?.supportsImages).toBe(false);
    expect(resolveOpenWeights({ ...BASETEN_ENV, OPEN_WEIGHTS_VISION: "1" })?.supportsImages).toBe(true);
  });
});

describe("open-weights on a hand-set endpoint", () => {
  it("keeps the three generic variables working and spots Modal and Baseten by hostname", () => {
    const modal = resolveOpenWeights({
      OPEN_WEIGHTS_BASE_URL: "https://ws--damage-desk-glimmer-glimmer-serve.modal.run/v1",
      OPEN_WEIGHTS_MODEL: "muse-glimmer",
    });
    expect(modal).toMatchObject({ host: "modal", apiKey: "EMPTY", supportsImages: true });
    expect(
      resolveOpenWeights({
        OPEN_WEIGHTS_PROVIDER: "custom",
        OPEN_WEIGHTS_BASE_URL: "https://inference.baseten.co/v1",
        OPEN_WEIGHTS_MODEL: "meta-models/muse-spark-open",
        OPEN_WEIGHTS_API_KEY: "placeholder-not-a-key",
      }),
    ).toMatchObject({ host: "baseten", apiKey: "placeholder-not-a-key" });
    expect(
      resolveOpenWeights({ OPEN_WEIGHTS_BASE_URL: "https://llm.example.invalid/v1", OPEN_WEIGHTS_MODEL: "m" })?.host,
    ).toBe("custom");
    expect(resolveOpenWeights({ OPEN_WEIGHTS_MODEL: "muse-glimmer" })).toBeNull();
  });
});

describe("describeEngine: what a run says it ran on", () => {
  it("names model and host truthfully for Baseten and for Modal", () => {
    expect(describeEngine("open-weights", BASETEN_ENV)).toMatchObject({
      host: "baseten",
      model: "meta-models/muse-spark-open-1026",
      label: "Muse Spark Open (open weights, served by Baseten)",
      short: "Muse Spark Open on Baseten",
    });
    expect(
      describeEngine("open-weights", {
        OPEN_WEIGHTS_BASE_URL: "https://ws--g.modal.run/v1",
        OPEN_WEIGHTS_MODEL: "muse-glimmer",
      }),
    ).toMatchObject({
      host: "modal",
      label: "Muse Glimmer (open weights, served by Modal)",
      short: "Muse Glimmer on Modal",
    });
  });

  it("never puts a URL or hostname in a label (the PDF footer goes to a carrier)", () => {
    const d = describeEngine("open-weights", {
      OPEN_WEIGHTS_BASE_URL: "https://secret-workspace.internal.example.invalid/v1",
      OPEN_WEIGHTS_MODEL: "muse-spark-open",
    });
    expect(d.label).toBe("Muse Spark Open (open weights, custom endpoint)");
    expect(d.label + d.short).not.toMatch(/example|internal|https/);
  });

  it("keeps the labels of the Meta engine and of the mock, and marks OpenRouter as a test engine", () => {
    expect(describeEngine("muse-spark-1.3").label).toBe("Muse Spark 1.3 (Meta Model API)");
    expect(describeEngine("demo-mock").label).toBe("demo-mock (DEMO MODE, not Muse)");
    expect(describeEngine("openrouter", {}).label).toBe("Muse Spark 1.3 via OpenRouter (test engine, not private)");
    expect(describeEngine("openrouter", { OPENROUTER_MODEL: "meta/muse-spark-open" }).short).toBe(
      "Muse Spark Open via OpenRouter (test)",
    );
  });

  it("falls back to a vague label only when nothing is configured", () => {
    expect(describeEngine("open-weights", {}).label).toBe("open-weights model");
  });

  it("strips characters a PDF font cannot draw from an unknown model id", () => {
    expect(modelDisplayName("m\u00f6del/x y")).toBe("mdel/xy");
  });
});

describe("the OpenRouter test engine", () => {
  it("is used only with its key and falls back to the labelled mock otherwise", () => {
    expect(resolveEngine("openrouter", {})).toBe("demo-mock");
    expect(resolveEngine("openrouter", { OPENROUTER_API_KEY: "  " })).toBe("demo-mock");
    expect(resolveEngine("openrouter", { OPENROUTER_API_KEY: "placeholder-not-a-key" })).toBe("openrouter");
  });

  it("is never what an unspecified request resolves to", () => {
    expect(resolveEngine(undefined, { OPENROUTER_API_KEY: "placeholder-not-a-key" })).toBe("demo-mock");
    expect(resolveEngine(undefined, { OPENROUTER_API_KEY: "placeholder-not-a-key", MODEL_API_KEY: "placeholder" })).toBe(
      "muse-spark-1.3",
    );
  });
});
