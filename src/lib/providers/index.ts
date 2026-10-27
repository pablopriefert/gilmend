import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import {
  META_API_BASE_URL,
  MUSE_SPARK_MODEL,
  assertStandardModel,
  type Env,
} from "../config";
import type { Engine } from "../types";
import { createMockProvider } from "./mock";
import { createOpenAiCompatibleProvider } from "./openai-compatible";

/**
 * Chat params are exactly the OpenAI client's, so tools, `response_format` with a
 * json_schema and `image_url` content parts all work on every provider. `model` is
 * filled in by the provider (never by callers), so nobody can pick a -contributor id.
 */
export type ChatParams = Omit<ChatCompletionCreateParamsNonStreaming, "model" | "stream">;

export interface Provider {
  engine: Engine;
  /** Model id actually used; "demo-mock" for the mock provider. */
  model: string;
  /** True for the deterministic mock: the UI and logs must label it as demo mode. */
  isMock: boolean;
  /** `options.timeoutMs` bounds this one call (the agent passes what is left of its time budget). */
  chat(params: ChatParams, options?: { timeoutMs?: number }): Promise<ChatCompletion>;
}

const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const GLIMMER_STRENGTHS = ["low", "medium", "high", "xhigh"] as const;

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  const v = value?.trim().toLowerCase();
  return allowed.find((a) => a === v);
}

/**
 * Modal proxy-auth token pair (Modal-Key / Modal-Secret). The Glimmer server is published
 * with `requires_proxy_auth=True`, because vLLM's --api-key leaves /invocations open: without
 * these headers Modal answers 401 before the request reaches vLLM.
 */
function modalProxyHeaders(env: Env): Record<string, string> | undefined {
  const key = env.OPEN_WEIGHTS_PROXY_KEY?.trim();
  const secret = env.OPEN_WEIGHTS_PROXY_SECRET?.trim();
  return key && secret ? { "Modal-Key": key, "Modal-Secret": secret } : undefined;
}

/**
 * Build the provider for an engine.
 *  - "muse-spark-1.3": Meta Model API, Standard model id, key from MODEL_API_KEY.
 *  - "open-weights": any OpenAI-compatible endpoint (Muse Glimmer on Modal, Muse Spark
 *    Open elsewhere) from OPEN_WEIGHTS_BASE_URL / _API_KEY / _MODEL.
 *  - "demo-mock": deterministic scripted provider, no network, no key.
 * A real engine without its credentials throws: choosing the mock instead is the job of
 * resolveEngine() (config.ts), which is explicit and gets labelled.
 */
export function getProvider(engine: Engine, env: Env = process.env): Provider {
  switch (engine) {
    case "demo-mock":
      return createMockProvider();

    case "muse-spark-1.3": {
      const apiKey = env.MODEL_API_KEY?.trim();
      if (!apiKey) throw new Error("MODEL_API_KEY is not set: cannot call Muse Spark 1.3.");
      const effort = pick(env.MODEL_REASONING_EFFORT, REASONING_EFFORTS);
      return createOpenAiCompatibleProvider({
        engine,
        model: assertStandardModel(MUSE_SPARK_MODEL),
        baseURL: env.MODEL_BASE_URL?.trim() || META_API_BASE_URL,
        apiKey,
        // Meta calibrates the model for its own default temperature, so none is sent.
        defaults: effort ? { reasoning_effort: effort } : undefined,
      });
    }

    case "open-weights": {
      const baseURL = env.OPEN_WEIGHTS_BASE_URL?.trim();
      const model = env.OPEN_WEIGHTS_MODEL?.trim();
      if (!baseURL || !model) {
        throw new Error("OPEN_WEIGHTS_BASE_URL and OPEN_WEIGHTS_MODEL are required for the open-weights engine.");
      }
      const strength = pick(env.OPEN_WEIGHTS_REASONING_STRENGTH, GLIMMER_STRENGTHS);
      return createOpenAiCompatibleProvider({
        engine,
        model: assertStandardModel(model),
        baseURL,
        // vLLM accepts any bearer value when it was started without --api-key.
        apiKey: env.OPEN_WEIGHTS_API_KEY?.trim() || "EMPTY",
        // Sampling published for Muse Glimmer (model card and vLLM recipe): do not run it
        // greedy. top_k is not in the OpenAI schema but vLLM reads it from the body.
        defaults: { temperature: 1.0, top_p: 0.95, top_k: 64 },
        headers: modalProxyHeaders(env),
        systemSuffix: strength ? `Reasoning strength: ${strength}` : undefined,
      });
    }
  }
}
