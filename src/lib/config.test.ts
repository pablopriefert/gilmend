import { describe, expect, it } from "vitest";
import {
  MUSE_SPARK_MODEL,
  assertStandardModel,
  hasModelKey,
  resolveEngine,
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
