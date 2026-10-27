// @vitest-environment jsdom
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeResults } from "@/lib/eval/test-helpers";
import EvalPage from "./page";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "gilmend-eval-page-"));
  vi.stubEnv("DAMAGE_DESK_EVAL_DIR", dir);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("Evaluation page", () => {
  it("renders the latest committed results from a fixture file", () => {
    writeFileSync(path.join(dir, "2026-10-27-muse-spark-1.3.json"), JSON.stringify(makeResults()));
    render(<EvalPage />);
    expect(screen.getByRole("heading", { level: 1, name: "How the agent holds up" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Broken vase/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Crushed carton/ })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/not a benchmark/);
  });

  it("shows the newest of several evaluations", () => {
    writeFileSync(path.join(dir, "old.json"), JSON.stringify(makeResults({ generatedAt: "2026-10-26T10:00:00.000Z", commit: "oldoldo" })));
    writeFileSync(path.join(dir, "new.json"), JSON.stringify(makeResults({ generatedAt: "2026-10-27T10:00:00.000Z", commit: "newnewn" })));
    render(<EvalPage />);
    expect(screen.getByText("newnewn")).toBeInTheDocument();
    expect(screen.queryByText("oldoldo")).not.toBeInTheDocument();
  });

  it("says nothing was committed rather than showing a stand-in", () => {
    render(<EvalPage />);
    expect(screen.getByText(/No evaluation has been committed yet/)).toBeInTheDocument();
    expect(screen.queryByText(/of 6 runs/)).not.toBeInTheDocument();
  });

  it("does not pass a broken results file off as 'nothing yet', and hides the details", () => {
    writeFileSync(path.join(dir, "broken.json"), "{ /home/secret");
    render(<EvalPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be read/);
    expect(screen.getByRole("alert").textContent).not.toMatch(/secret/);
  });
});
