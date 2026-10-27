import type { Engine, EngineDetail, EngineHost } from "./types";

/** Narrow env shape so tests can pass plain objects. */
export type Env = Record<string, string | undefined>;

// Meta Model API, OpenAI-compatible.
export const META_API_BASE_URL = "https://api.meta.ai/v1";

// Standard mode only. A "-contributor" model id makes Meta train on what we send, and
// the hackathon data (even fictitious) must not leave that way.
export const MUSE_SPARK_MODEL = "muse-spark-1.3";

/** Throws if a model id would route traffic to a Contributor-mode model. */
export function assertStandardModel(modelId: string): string {
  if (/contributor/i.test(modelId)) {
    throw new Error(
      `Refusing model id "${modelId}": Contributor models let Meta train on our traffic. Use the Standard id "${MUSE_SPARK_MODEL}".`,
    );
  }
  return modelId;
}

// Baseten Model APIs: OpenAI-compatible, Bearer auth (docs.baseten.co/inference/model-apis/overview,
// read 27 Oct 2026). Muse Spark Open takes image_url parts and tools there; it does NOT support
// response_format / JSON mode, which is fine: the agent decides through the finish_case tool.
export const BASETEN_BASE_URL = "https://inference.baseten.co/v1";
// Slug given by the hackathon guide. Baseten's public docs list `meta-models/muse-spark-open`
// (no date suffix) on 27 Oct 2026, so the slug is overridable (BASETEN_MODEL) and
// scripts/check-baseten.ts asks Baseten's /v1/models whether the configured one exists.
export const BASETEN_MUSE_SPARK_OPEN_MODEL = "meta-models/muse-spark-open-1026";

// OpenRouter, OpenAI-compatible. The "test" engine for cheap bulk runs: it is neither open
// weights as far as this app can prove, nor private (the photos go to OpenRouter and Meta).
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_DEFAULT_MODEL = "meta/muse-spark-1.3";

export function hasModelKey(env: Env = process.env): boolean {
  return Boolean(env.MODEL_API_KEY && env.MODEL_API_KEY.trim() !== "");
}

export function hasOpenRouterKey(env: Env = process.env): boolean {
  return Boolean(env.OPENROUTER_API_KEY && env.OPENROUTER_API_KEY.trim() !== "");
}

/** Friendly name of a Muse model id, for labels. Unknown ids are shown as they are. */
export function modelDisplayName(model: string): string {
  if (/muse-spark-open/i.test(model)) return "Muse Spark Open";
  if (/muse-glimmer/i.test(model)) return "Muse Glimmer";
  const spark = model.match(/muse-spark-(\d+(?:\.\d+)?)/i);
  if (spark) return `Muse Spark ${spark[1]}`;
  // Labels end up in the claim PDF (standard fonts, ASCII only): keep what a model id may hold.
  return model.replace(/[^\w./:@-]/g, "");
}

/** Hosts of the open-weights engine, from the endpoint URL when it was set by hand. */
function hostOfUrl(baseURL: string): EngineHost {
  let hostname = "";
  try {
    hostname = new URL(baseURL).hostname.toLowerCase();
  } catch {
    return "custom";
  }
  if (hostname === "baseten.co" || hostname.endsWith(".baseten.co")) return "baseten";
  if (hostname.endsWith(".modal.run")) return "modal";
  return "custom";
}

/** The label never carries a hostname or a URL: the claim PDF goes to a carrier. */
function openWeightsDetail(model: string, host: EngineHost): EngineDetail {
  const name = modelDisplayName(model);
  const where = host === "baseten" ? "Baseten" : host === "modal" ? "Modal" : null;
  return {
    model,
    host,
    label: where
      ? `${name} (open weights, served by ${where})`
      : `${name} (open weights, custom endpoint)`,
    short: where ? `${name} on ${where}` : `${name} (custom endpoint)`,
  };
}

export interface OpenWeightsSetup {
  host: EngineHost;
  baseURL: string;
  model: string;
  /** Bearer value sent to the server ("EMPTY" for a vLLM started without --api-key). */
  apiKey: string;
  /** False when the model cannot read images: the agent then does not send the photos. */
  supportsImages: boolean;
  detail: EngineDetail;
}

const OFF = /^(0|false|no|off)$/i;

/**
 * The "Run privately" engine, from the environment. Two ways to configure it, never mixed:
 *  - OPEN_WEIGHTS_PROVIDER=baseten: Muse Spark Open on Baseten's Model APIs, from BASETEN_API_KEY
 *    (and BASETEN_MODEL if the slug differs). Nothing else needs to be set.
 *  - otherwise (empty, "custom" or "modal"): any OpenAI-compatible server from
 *    OPEN_WEIGHTS_BASE_URL / _MODEL / _API_KEY (Muse Glimmer on Modal, Muse Spark Open elsewhere).
 * Returns null when the chosen way is incomplete, so the caller falls back to the labelled
 * mock instead of calling the wrong host. An unknown OPEN_WEIGHTS_PROVIDER is a typo, not a
 * reason to guess another host: it also returns null.
 */
export function resolveOpenWeights(env: Env = process.env): OpenWeightsSetup | null {
  const provider = env.OPEN_WEIGHTS_PROVIDER?.trim().toLowerCase() ?? "";
  if (provider === "baseten") {
    const apiKey = env.BASETEN_API_KEY?.trim();
    if (!apiKey) return null;
    const model = env.BASETEN_MODEL?.trim() || BASETEN_MUSE_SPARK_OPEN_MODEL;
    return {
      host: "baseten",
      baseURL: BASETEN_BASE_URL,
      model,
      apiKey,
      supportsImages: !OFF.test(env.OPEN_WEIGHTS_VISION?.trim() ?? ""),
      detail: openWeightsDetail(model, "baseten"),
    };
  }
  if (provider !== "" && provider !== "custom" && provider !== "modal") return null;
  const baseURL = env.OPEN_WEIGHTS_BASE_URL?.trim();
  const model = env.OPEN_WEIGHTS_MODEL?.trim();
  if (!baseURL || !model) return null;
  const host = hostOfUrl(baseURL);
  return {
    host,
    baseURL,
    model,
    // vLLM accepts any bearer value when it was started without --api-key.
    apiKey: env.OPEN_WEIGHTS_API_KEY?.trim() || "EMPTY",
    supportsImages: !OFF.test(env.OPEN_WEIGHTS_VISION?.trim() ?? ""),
    detail: openWeightsDetail(model, host),
  };
}

export function hasOpenWeightsConfig(env: Env = process.env): boolean {
  return resolveOpenWeights(env) !== null;
}

/** Model id of the OpenRouter test engine (OPENROUTER_MODEL overrides the default). */
export function openRouterModel(env: Env = process.env): string {
  return env.OPENROUTER_MODEL?.trim() || OPENROUTER_DEFAULT_MODEL;
}

/**
 * What an engine is, as it must be written on screen and in the claim PDF. For "open-weights"
 * this follows the environment, so the label says which model and host actually run.
 */
export function describeEngine(engine: Engine, env: Env = process.env): EngineDetail {
  switch (engine) {
    case "muse-spark-1.3":
      return {
        model: MUSE_SPARK_MODEL,
        host: "meta",
        label: "Muse Spark 1.3 (Meta Model API)",
        short: "Muse Spark 1.3",
      };
    case "open-weights":
      return (
        resolveOpenWeights(env)?.detail ?? {
          model: "open-weights",
          host: "custom",
          label: "open-weights model",
          short: "Open weights",
        }
      );
    case "openrouter": {
      const model = openRouterModel(env);
      const name = modelDisplayName(model);
      return {
        model,
        host: "openrouter",
        label: `${name} via OpenRouter (test engine, not private)`,
        short: `${name} via OpenRouter (test)`,
      };
    }
    case "demo-mock":
      return {
        model: "demo-mock",
        host: "mock",
        // Never let a mock run pass for a Muse run, not even in a footer.
        label: "demo-mock (DEMO MODE, not Muse)",
        short: "DEMO MODE",
      };
  }
}

/**
 * Pick the engine to run. Without the matching credentials we fall back to the mock
 * provider ("demo-mock") instead of failing, and the UI/logs must say so: a mock answer
 * is never presented as coming from Muse.
 */
export function resolveEngine(
  requested: Engine | undefined,
  env: Env = process.env,
): Engine {
  const wanted = requested ?? "muse-spark-1.3";
  if (wanted === "demo-mock") return "demo-mock";
  if (wanted === "open-weights") return hasOpenWeightsConfig(env) ? "open-weights" : "demo-mock";
  if (wanted === "openrouter") return hasOpenRouterKey(env) ? "openrouter" : "demo-mock";
  return hasModelKey(env) ? "muse-spark-1.3" : "demo-mock";
}
