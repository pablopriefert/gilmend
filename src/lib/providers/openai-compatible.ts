import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { assertStandardModel } from "../config";
import type { ChatParams, Provider } from "./index";
import type { Engine } from "../types";

export interface OpenAiCompatibleOptions {
  engine: Exclude<Engine, "demo-mock">;
  model: string;
  baseURL: string;
  apiKey: string;
  /** Request fields added unless the caller sets them (sampling defaults, reasoning effort). */
  defaults?: Record<string, unknown>;
  /**
   * Extra HTTP headers on every request. Used for the Modal proxy-auth token pair of the open
   * weights server (vLLM's --api-key only protects /v1, not /invocations; Modal's proxy auth
   * protects the whole URL).
   */
  headers?: Record<string, string>;
  /** Appended to the system message (e.g. Glimmer's "Reasoning strength: high" line). */
  systemSuffix?: string;
}

/**
 * One OpenAI-compatible provider serves both real engines: the Meta Model API (Muse
 * Spark 1.3) and an open-weights server (vLLM on Modal, or a hosted provider). Only the
 * base URL, key, model id and a few defaults differ.
 */
export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): Provider {
  // Checked here as well as in getProvider so no code path can reach a Contributor model.
  const model = assertStandardModel(opts.model);
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    // Reasoning models can take a while, but the route has a platform time limit: fail
    // clearly rather than hang. runAgent narrows this per call to what is left of its budget.
    timeout: 45_000,
    maxRetries: 1,
    ...(opts.headers && Object.keys(opts.headers).length > 0 ? { defaultHeaders: opts.headers } : {}),
  });

  return {
    engine: opts.engine,
    model,
    isMock: false,
    async chat(params: ChatParams, options?: { timeoutMs?: number }): Promise<ChatCompletion> {
      const messages = opts.systemSuffix
        ? params.messages.map((m) =>
            m.role === "system" && typeof m.content === "string"
              ? { ...m, content: `${m.content}\n\n${opts.systemSuffix}` }
              : m,
          )
        : params.messages;
      // Defaults first so an explicit caller value wins. `model` and `stream` are set last
      // on purpose: callers cannot pick a model id.
      const body = { ...opts.defaults, ...params, messages, model, stream: false as const };
      return client.chat.completions.create(
        body as Parameters<typeof client.chat.completions.create>[0] & { stream: false },
        options?.timeoutMs ? { timeout: options.timeoutMs } : undefined,
      );
    },
  };
}
