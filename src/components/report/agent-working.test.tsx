// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_STEPS, AgentWorking, stepAt } from "./agent-working";

afterEach(() => vi.useRealTimers());

describe("stepAt", () => {
  it("advances with the clock and stays on the last step until the answer arrives", () => {
    expect(stepAt(0)).toBe(0);
    expect(stepAt(13)).toBe(1);
    expect(stepAt(30)).toBe(2);
    expect(stepAt(39)).toBe(4);
    expect(stepAt(600)).toBe(AGENT_STEPS.length - 1);
  });
});

describe("AgentWorking", () => {
  it("marks the step in progress, then the ones done, and says it is an illustration", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    render(<AgentWorking engine="muse-spark-1.3" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-current", "step");
    expect(items[0]).toHaveTextContent("(in progress)");
    expect(items[1]).toHaveTextContent("(waiting)");

    await act(async () => {
      vi.advanceTimersByTime(14_000);
    });
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("(done)");
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/not live progress/)).toBeInTheDocument();
  });

  it("never claims a model is running in demo mode", () => {
    render(<AgentWorking engine="demo-mock" />);
    expect(screen.getByText("DEMO MODE: deterministic mock, not Muse")).toBeInTheDocument();
    expect(screen.getByText(/no model is called/)).toBeInTheDocument();
  });
});
