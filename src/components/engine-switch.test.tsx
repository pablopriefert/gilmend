// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { describeEngine } from "@/lib/config";
import { EngineSwitch, photoDestination } from "./engine-switch";

const NONE = { museKey: false, openWeights: false };

describe("photoDestination", () => {
  it("names where the photos really go, engine by engine", () => {
    expect(photoDestination("muse-spark-1.3", { museKey: true, openWeights: false })).toMatch(/Meta Model API/);
    expect(photoDestination("demo-mock", NONE)).toMatch(/No model is called/);
    expect(photoDestination("openrouter", { ...NONE, openRouter: true })).toMatch(/OpenRouter and Meta\. Not private/);
  });

  it("says a private run is hosted by Baseten, not on your hardware, when that is the host", () => {
    const detail = describeEngine("open-weights", { OPEN_WEIGHTS_PROVIDER: "baseten", BASETEN_API_KEY: "placeholder" });
    const text = photoDestination("open-weights", { museKey: true, openWeights: true, openWeightsDetail: detail });
    expect(text).toMatch(/Baseten \(not your own hardware\)/);
    expect(text).toMatch(/never to the Meta Model API/);
  });
});

describe("EngineSwitch", () => {
  it("offers native radios with the honest description of each option, and reports the choice", () => {
    const onChange = vi.fn();
    render(<EngineSwitch value="muse-spark-1.3" onChange={onChange} availability={NONE} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3); // no OpenRouter without its key
    expect(screen.getByRole("radio", { name: /Muse Spark 1\.3 \(Model API\)/ })).toBeChecked();
    // Not configured here: the card says it runs in demo mode.
    expect(screen.getByRole("radio", { name: /Muse Spark 1\.3 \(Model API\)/ })).toHaveAccessibleName(/runs in demo mode/);
    fireEvent.click(screen.getByRole("radio", { name: /Demo mode/ }));
    expect(onChange).toHaveBeenCalledWith("demo-mock");
  });

  it("names no engine and no destination while the access code is missing", () => {
    render(<EngineSwitch value="muse-spark-1.3" onChange={vi.fn()} availability={{ museKey: true, openWeights: false, accessCodeRequired: true }} hasAccess={false} />);
    expect(screen.getByTestId("needs-access-code")).toHaveTextContent("Needs the access code");
    expect(screen.queryByTestId("photo-destination")).not.toBeInTheDocument();
  });
});
