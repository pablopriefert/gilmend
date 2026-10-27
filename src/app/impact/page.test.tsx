// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "@/components/app-header";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/impact" }));

// Real function by default (the test points it at the committed recordings); one test makes it fail.
const listShowcase = vi.hoisted(() => ({ failWith: null as Error | null }));
vi.mock("@/lib/showcase/showcase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/showcase/showcase")>();
  return {
    ...actual,
    listShowcaseCases: (...args: Parameters<typeof actual.listShowcaseCases>) => {
      if (listShowcase.failWith) return Promise.reject(listShowcase.failWith);
      return actual.listShowcaseCases(...args);
    },
  };
});

import ImpactPage from "./page";

/** A stat is a label, a figure and a note in one block: the test id sits on the figure. */
const block = (id: string) => screen.getByTestId(id).parentElement?.textContent ?? "";

const REAL_SHOWCASE = path.join(process.cwd(), "data", "showcase");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  listShowcase.failWith = null;
});

describe("Impact page", () => {
  it("measures the agent's time on the committed recorded runs, not on a number written in the page", async () => {
    vi.stubEnv("DAMAGE_DESK_SHOWCASE_DIR", REAL_SHOWCASE);
    render(await ImpactPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("What a damaged parcel costs, and what a deadline takes");
    const summary = screen.getByTestId("measured-summary").textContent ?? "";
    // The blurry-photo run stops at "ask for better photos" and never calls SAM: the page counts it.
    expect(summary).toMatch(/over 6 real runs of Muse Spark 1\.3, 5 of them with a SAM 3\.1 outline, recorded on 27 Oct 2026/);
    // The time in the calculator is that same mean, to the second.
    const mean = Number(/Mean (\d+(?:\.\d)?) s/.exec(summary)?.[1]);
    expect(mean).toBeGreaterThan(5);
    expect(mean).toBeLessThan(120);
    expect(block("roi-time-gilmend")).toContain(`Agent ${Math.round(mean)} s, measured on`);
  });

  it("still works, and says the time is not measured, when the server has no recorded run (tests, a bare clone)", async () => {
    render(await ImpactPage());
    expect(screen.getByTestId("measured-none")).toBeInTheDocument();
    expect(block("roi-time-gilmend")).toContain("not measured here");
    expect(screen.getByTestId("roi-damaged")).toHaveTextContent("96");
  });

  it("survives an unreadable showcase and keeps its detail out of the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listShowcase.failWith = new Error("EACCES: /home/secret");
    render(await ImpactPage());
    expect(screen.getByTestId("measured-none")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret");
  });
});

describe("Header", () => {
  it("links to the Impact page and marks it as the current one", () => {
    render(<AppHeader />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const link = Array.from(nav.querySelectorAll("a")).find((a) => a.textContent === "Impact");
    expect(link).toHaveAttribute("href", "/impact");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(nav.querySelector("a[href='/']")).not.toHaveAttribute("aria-current");
  });
});
