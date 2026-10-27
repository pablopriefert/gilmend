import type { Engine } from "./types";

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

export function hasModelKey(env: Env = process.env): boolean {
  return Boolean(env.MODEL_API_KEY && env.MODEL_API_KEY.trim() !== "");
}

export function hasOpenWeightsConfig(env: Env = process.env): boolean {
  return Boolean(env.OPEN_WEIGHTS_BASE_URL && env.OPEN_WEIGHTS_MODEL);
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
  return hasModelKey(env) ? "muse-spark-1.3" : "demo-mock";
}
