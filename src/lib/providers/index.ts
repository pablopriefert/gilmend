import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { randomUUID } from "node:crypto";
import {
  META_API_BASE_URL,
  MUSE_SPARK_MODEL,
  OPENROUTER_BASE_URL,
  assertStandardModel,
  describeEngine,
  openRouterModel,
  resolveOpenWeights,
  type Env,
} from "../config";
import type { Engine, EngineDetail } from "../types";
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
  /** Which model and host this provider really talks to, stored with the case. Absent on test fakes. */
  detail?: EngineDetail;
  /**
   * False when the model behind this provider cannot read images (OPEN_WEIGHTS_VISION=0). The
   * agent then keeps the photos back and says so, instead of letting the model guess. Absent
   * means true.
   */
  supportsImages?: boolean;
  /** `options.timeoutMs` bounds this one call (the agent passes what is left of its time budget). */
  chat(params: ChatParams, options?: { timeoutMs?: number }): Promise<ChatCompletion>;
}

const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const GLIMMER_STRENGTHS = ["low", "medium", "high", "xhigh"] as const;
// Reasoning depths Baseten accepts for Muse Spark Open (it always reasons; "none" and "minimal"
// would run at "low" anyway). Unset means "medium", see the open-weights case below.
const BASETEN_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

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
 *  - "open-weights": Muse Spark Open on Baseten (OPEN_WEIGHTS_PROVIDER=baseten and
 *    BASETEN_API_KEY), or any other OpenAI-compatible endpoint (Muse Glimmer on Modal, Muse
 *    Spark Open elsewhere) from OPEN_WEIGHTS_BASE_URL / _API_KEY / _MODEL. See resolveOpenWeights.
 *  - "openrouter": the cheap test engine, OPENROUTER_API_KEY.
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
        detail: describeEngine(engine, env),
        // Meta calibrates the model for its own default temperature, so none is sent.
        defaults: effort ? { reasoning_effort: effort } : undefined,
      });
    }

    case "open-weights": {
      const setup = resolveOpenWeights(env);
      if (!setup) {
        if (env.OPEN_WEIGHTS_PROVIDER?.trim().toLowerCase() === "baseten") {
          throw new Error("BASETEN_API_KEY is not set: OPEN_WEIGHTS_PROVIDER=baseten needs it.");
        }
        throw new Error("OPEN_WEIGHTS_BASE_URL and OPEN_WEIGHTS_MODEL are required for the open-weights engine.");
      }
      const common = {
        engine,
        model: assertStandardModel(setup.model),
        baseURL: setup.baseURL,
        apiKey: setup.apiKey,
        supportsImages: setup.supportsImages,
        detail: setup.detail,
      };
      if (setup.host === "baseten") {
        // Muse Spark Open always reasons. Baseten's default depth is xhigh, which can take
        // minutes over eight tool turns with photos; "medium" keeps a run inside the 90 s budget
        // we budget for (untested against the live endpoint, override with
        // OPEN_WEIGHTS_REASONING_STRENGTH). Sampling is the one on the model card
        // (temperature 1.0, top_p 1.0, top_k off).
        const effort = pick(env.OPEN_WEIGHTS_REASONING_STRENGTH, BASETEN_EFFORTS) ?? "medium";
        return createOpenAiCompatibleProvider({
          ...common,
          defaults: { temperature: 1.0, top_p: 1.0, reasoning_effort: effort },
          // One random id per provider, so per run: Baseten reuses the cached prompt prefix (the
          // photos are re-sent on every turn) for requests that share it. Nothing about the case.
          headers: { "x-session-affinity": randomUUID() },
        });
      }
      const strength = pick(env.OPEN_WEIGHTS_REASONING_STRENGTH, GLIMMER_STRENGTHS);
      return createOpenAiCompatibleProvider({
        ...common,
        // Sampling published for Muse Glimmer (model card and vLLM recipe): do not run it
        // greedy. top_k is not in the OpenAI schema but vLLM reads it from the body.
        defaults: { temperature: 1.0, top_p: 0.95, top_k: 64 },
        headers: modalProxyHeaders(env),
        systemSuffix: strength ? `Reasoning strength: ${strength}` : undefined,
      });
    }

    case "openrouter": {
      const apiKey = env.OPENROUTER_API_KEY?.trim();
      if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set: cannot call OpenRouter.");
      const effort = pick(env.MODEL_REASONING_EFFORT, REASONING_EFFORTS);
      return createOpenAiCompatibleProvider({
        engine,
        model: assertStandardModel(openRouterModel(env)),
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
        detail: describeEngine(engine, env),
        defaults: {
          ...(effort ? { reasoning_effort: effort } : {}),
          // Only route to endpoints that do not store prompts or train on them.
          provider: { data_collection: "deny" },
        },
        headers: { "X-Title": "Damage Desk (hackathon test engine)" },
      });
    }
  }
}
