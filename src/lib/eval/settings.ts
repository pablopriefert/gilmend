import { META_API_BASE_URL, OPENROUTER_BASE_URL, resolveOpenWeights, type Env } from "../config";
import type { Engine } from "../types";
import type { EvalSettings } from "./types";

// The two settings that change what an evaluation measures (how long the model reasons, which API
// answers) and that are not in the command: the environment sets them. They are recorded in the
// results file so "Reproduce it" can say what to set (review of 27 Oct 2026: the first committed
// file did not carry them, and the page says "not recorded" for it rather than guess).

const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const GLIMMER_STRENGTHS = ["low", "medium", "high", "xhigh"];
// Hosts we name in a public file. Any other host is a private endpoint: its name stays out.
const KNOWN_HOSTS = ["api.meta.ai", "openrouter.ai", "inference.baseten.co"];

function pick(value: string | undefined, allowed: readonly string[]): string | null {
  const v = value?.trim().toLowerCase();
  return allowed.find((a) => a === v) ?? null;
}

function hostLabel(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return KNOWN_HOSTS.includes(host) ? host : "custom endpoint";
  } catch {
    return "custom endpoint";
  }
}

/** What the environment sets for this engine: reasoning effort (or "provider default") and API host. */
export function describeEvalSettings(engine: Exclude<Engine, "demo-mock">, env: Env): EvalSettings {
  const DEFAULT = "provider default";
  switch (engine) {
    case "muse-spark-1.3":
      return {
        reasoningEffort: pick(env.MODEL_REASONING_EFFORT, EFFORTS) ?? DEFAULT,
        apiHost: hostLabel(env.MODEL_BASE_URL?.trim() || META_API_BASE_URL),
      };
    case "openrouter":
      return {
        reasoningEffort: pick(env.MODEL_REASONING_EFFORT, EFFORTS) ?? DEFAULT,
        apiHost: hostLabel(OPENROUTER_BASE_URL),
      };
    case "open-weights": {
      const setup = resolveOpenWeights(env);
      const strength = pick(env.OPEN_WEIGHTS_REASONING_STRENGTH, GLIMMER_STRENGTHS);
      return {
        // The Baseten preset always reasons and defaults to "medium" (src/lib/providers/index.ts).
        reasoningEffort: strength ?? (setup?.preset === "baseten" ? "medium" : DEFAULT),
        apiHost: setup ? hostLabel(setup.baseURL) : "custom endpoint",
      };
    }
  }
}
