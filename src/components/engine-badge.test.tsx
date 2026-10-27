// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
