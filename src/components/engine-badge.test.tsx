// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { describeEngine } from "@/lib/config";
import { EngineBadge } from "./engine-badge";

describe("EngineBadge", () => {
  it("labels the mock provider as demo mode, never as Muse", () => {
    render(<EngineBadge engine="demo-mock" />);
    const badge = screen.getByText(/DEMO MODE/);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-engine", "demo-mock");
    expect(badge.textContent).toMatch(/not Muse/);
  });

  it("names Muse Spark 1.3 for the real engine", () => {
    render(<EngineBadge engine="muse-spark-1.3" />);
    expect(screen.getByText(/Muse Spark 1\.3/)).toBeInTheDocument();
    expect(screen.queryByText(/DEMO MODE/)).not.toBeInTheDocument();
  });

  it("names the model and the host of an open-weights run, never just a vague label", () => {
    const detail = describeEngine("open-weights", { OPEN_WEIGHTS_PROVIDER: "baseten", BASETEN_API_KEY: "placeholder" });
    const { rerender } = render(<EngineBadge engine="open-weights" detail={detail} />);
    expect(screen.getByText("Muse Spark Open (open weights, served by Baseten)")).toHaveAttribute("data-engine", "open-weights");
    rerender(<EngineBadge engine="open-weights" detail={detail} compact />);
    expect(screen.getByText("Muse Spark Open on Baseten")).toBeInTheDocument();
    rerender(<EngineBadge engine="open-weights" />);
    expect(screen.getByText("Open weights (private run)")).toBeInTheDocument();
  });

  it("marks the OpenRouter engine as a test engine", () => {
    render(<EngineBadge engine="openrouter" />);
    expect(screen.getByText(/test engine, not private/)).toHaveAttribute("data-engine", "openrouter");
  });

  it("never lets a detail rename the mock or the Meta engine", () => {
    render(<EngineBadge engine="demo-mock" detail={describeEngine("open-weights", { OPEN_WEIGHTS_PROVIDER: "baseten", BASETEN_API_KEY: "x" })} />);
    expect(screen.getByText(/DEMO MODE/).textContent).toMatch(/not Muse/);
  });
});
