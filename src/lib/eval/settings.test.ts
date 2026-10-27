import { describe, expect, it } from "vitest";
import { describeEvalSettings } from "./settings";

describe("describeEvalSettings", () => {
  it("reads the reasoning effort and names the Meta API host", () => {
    expect(describeEvalSettings("muse-spark-1.3", { MODEL_REASONING_EFFORT: " High " })).toEqual({ reasoningEffort: "high", apiHost: "api.meta.ai" });
  });

  it("says 'provider default' when no effort is set, or one the provider would not accept", () => {
    expect(describeEvalSettings("muse-spark-1.3", {}).reasoningEffort).toBe("provider default");
    expect(describeEvalSettings("muse-spark-1.3", { MODEL_REASONING_EFFORT: "extreme" }).reasoningEffort).toBe("provider default");
  });

  it("does not write the name of a private endpoint into a public file", () => {
    const s = describeEvalSettings("muse-spark-1.3", { MODEL_BASE_URL: "https://my-team--gateway.modal.run/v1", MODEL_API_KEY: "key-not-real" });
    expect(s.apiHost).toBe("custom endpoint");
    expect(JSON.stringify(s)).not.toMatch(/modal|key/);
  });

  it("knows the open-weights Baseten default depth", () => {
    const s = describeEvalSettings("open-weights", { OPEN_WEIGHTS_PROVIDER: "baseten", BASETEN_API_KEY: "key-not-real" });
    expect(s).toEqual({ reasoningEffort: "medium", apiHost: "inference.baseten.co" });
  });

  it("names OpenRouter for the test engine", () => {
    expect(describeEvalSettings("openrouter", {}).apiHost).toBe("openrouter.ai");
  });
});
