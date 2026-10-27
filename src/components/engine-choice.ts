import type { Engine } from "@/lib/types";

export interface EngineAvailability {
  /** MODEL_API_KEY is set on the server. */
  museKey: boolean;
  /** OPEN_WEIGHTS_BASE_URL and OPEN_WEIGHTS_MODEL are set on the server. */
  openWeights: boolean;
  /** DAMAGE_DESK_ACCESS_CODE is set: a real engine needs the code, else the report runs in demo mode. */
  accessCodeRequired?: boolean;
}

export interface EngineOption {
  value: Engine;
  label: string;
  description: string;
  available: boolean;
}

/**
 * Browser-side twin of `resolveEngine` in lib/config (which reads the server environment):
 * what a requested engine will really run as, given what the server told the page it has.
 * Used only to be honest in the UI before submitting; the server decides for real.
 */
export function effectiveEngine(
  requested: Engine,
  availability: EngineAvailability,
  /** False when the server asks for an access code and none was typed. */
  hasAccess: boolean = true,
): Engine {
  if (requested === "demo-mock") return "demo-mock";
  if (availability.accessCodeRequired && !hasAccess) return "demo-mock";
  if (requested === "open-weights") return availability.openWeights ? "open-weights" : "demo-mock";
  return availability.museKey ? "muse-spark-1.3" : "demo-mock";
}

export function engineOptions(availability: EngineAvailability): EngineOption[] {
  return [
    {
      value: "muse-spark-1.3",
      label: "Muse Spark 1.3 (Model API)",
      description: availability.museKey
        ? "Meta Model API, Standard mode: vision, tool calls and structured output."
        : "No model key is set on this server, so this option runs in demo mode.",
      available: availability.museKey,
    },
    {
      value: "open-weights",
      label: "Run privately (open weights)",
      description: availability.openWeights
        ? "Same agent and tools on open-weights Muse models, nothing goes to the Model API."
        : "No open-weights endpoint is configured on this server, so this option runs in demo mode.",
      available: availability.openWeights,
    },
    {
      value: "demo-mock",
      label: "Demo mode",
      description: "Deterministic mock provider with canned answers. Not Muse.",
      available: true,
    },
  ];
}
