import type { Engine, EngineDetail } from "@/lib/types";

export interface EngineAvailability {
  /** MODEL_API_KEY is set on the server. */
  museKey: boolean;
  /** The open-weights engine is configured on the server (Baseten preset, or OPEN_WEIGHTS_BASE_URL and _MODEL). */
  openWeights: boolean;
  /** Which model and host the open-weights engine runs; set with `openWeights`. */
  openWeightsDetail?: EngineDetail;
  /** OPENROUTER_API_KEY is set: the cheap test engine is offered. */
  openRouter?: boolean;
  openRouterDetail?: EngineDetail;
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
  if (requested === "openrouter") return availability.openRouter ? "openrouter" : "demo-mock";
  return availability.museKey ? "muse-spark-1.3" : "demo-mock";
}

/** The model and host to name next to an engine, when the server told the page which they are. */
export function detailFor(engine: Engine, availability: EngineAvailability): EngineDetail | undefined {
  if (engine === "open-weights") return availability.openWeightsDetail;
  if (engine === "openrouter") return availability.openRouterDetail;
  return undefined;
}

/** Where the photos and the message go on a private run: said plainly, "private" is not "on your hardware". */
function openWeightsDescription(detail: EngineDetail | undefined): string {
  if (!detail) return "Same agent and tools on open-weights Muse models, nothing goes to the Model API.";
  const where =
    detail.host === "baseten"
      ? "Hosted by Baseten (not your own hardware): the photos and the message go to Baseten."
      : detail.host === "modal"
        ? "On the Modal deployment of this server: the photos and the message go there."
        : "On the endpoint configured on this server: the photos and the message go there.";
  return `${detail.label}. Same agent and tools, nothing goes to the Meta Model API. ${where}`;
}

export function engineOptions(availability: EngineAvailability): EngineOption[] {
  const options: EngineOption[] = [
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
        ? openWeightsDescription(availability.openWeightsDetail)
        : "No open-weights endpoint is configured on this server, so this option runs in demo mode.",
      available: availability.openWeights,
    },
  ];
  // The test engine is offered only on a server that has its key: it is never the default and
  // not something to show to a judge who has no use for it.
  if (availability.openRouter) {
    options.push({
      value: "openrouter",
      label: "Muse via OpenRouter (test)",
      description: `${availability.openRouterDetail?.label ?? "Muse via OpenRouter"}. For cheap test runs only: the photos and the message go to OpenRouter and Meta. Not private.`,
      available: true,
    });
  }
  options.push({
    value: "demo-mock",
    label: "Demo mode",
    description: "Deterministic mock provider with canned answers. Not Muse.",
    available: true,
  });
  return options;
}
