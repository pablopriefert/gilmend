// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCase, makeRules } from "@/components/fixtures";

const listCases = vi.fn();
const getCase = vi.fn();
const getCarrierRules = vi.fn();
vi.mock("@/lib/store/cases", () => ({ listCases: () => listCases(), getCase: (id: string) => getCase(id) }));
vi.mock("@/lib/rules/carriers", () => ({ getCarrierRules: (c: string) => getCarrierRules(c) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import CasesPage from "./page";
import CasePage from "./cases/[id]/page";
import ReportPage from "./report/page";

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const m of [listCases, getCase, getCarrierRules]) m.mockReset();
});

describe("Cases page", () => {
  it("lists the stored cases", async () => {
    listCases.mockResolvedValue([makeCase()]);
    render(await CasesPage());
    expect(screen.getByRole("heading", { name: "Cases" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /#1001/ })).toHaveAttribute("href", "/cases/case-1");
  });

  it("hides the details of an unexpected failure", async () => {
    listCases.mockRejectedValue(new Error("EACCES: /home/secret"));
    render(await CasesPage());
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/);
    expect(screen.getByRole("alert").textContent).not.toMatch(/secret/);
  });
});

describe("Case page", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("renders a needs_review case with the carrier rules of its order", async () => {
    getCase.mockResolvedValue(makeCase());
    getCarrierRules.mockReturnValue(makeRules());
    render(await CasePage(params("case-1")));
    expect(getCase).toHaveBeenCalledWith("case-1");
    expect(getCarrierRules).toHaveBeenCalledWith("colissimo");
    expect(screen.getByTestId("decision-kind")).toHaveTextContent("Reship");
    expect(screen.getByText("Colissimo claims conditions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("still renders when the carrier rules module throws", async () => {
    getCase.mockResolvedValue(makeCase());
    getCarrierRules.mockImplementation(() => {
      throw new Error("rules unavailable");
    });
    render(await CasePage(params("case-1")));
    expect(screen.getByText("The carrier rules could not be loaded for this case.")).toBeInTheDocument();
    expect(screen.getByTestId("decision-kind")).toBeInTheDocument();
  });

  it("is a 404 for an unknown case and for a malformed id, without reading the store for the latter", async () => {
    getCase.mockResolvedValue(null);
    await expect(CasePage(params("missing"))).rejects.toThrow("NEXT_NOT_FOUND");
    getCase.mockClear();
    await expect(CasePage(params("../etc"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getCase).not.toHaveBeenCalled();
  });

  it("says the store is unavailable rather than pretending the case does not exist", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getCase.mockRejectedValue(new Error("EACCES: /home/secret"));
    render(await CasePage(params("case-1")));
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/);
    expect(screen.getByRole("alert").textContent).not.toMatch(/secret/);
  });
});

describe("Report page", () => {
  it("tells the form which engines the server has", () => {
    vi.stubEnv("MODEL_API_KEY", "");
    vi.stubEnv("OPEN_WEIGHTS_BASE_URL", "");
    vi.stubEnv("OPEN_WEIGHTS_MODEL", "");
    render(<ReportPage />);
    expect(screen.getByRole("heading", { name: "Report a damaged parcel" })).toBeInTheDocument();
    expect(screen.getByText(/This report will run as/).textContent).toMatch(/DEMO MODE/);
  });

  it("offers Muse when a key is set", () => {
    vi.stubEnv("MODEL_API_KEY", "fake-key-for-test");
    render(<ReportPage />);
    expect(screen.getByText(/This report will run as/).textContent).toMatch(/Muse Spark 1\.3/);
  });

  it("says the private engine runs Muse Spark Open on Baseten when that preset is configured", () => {
    vi.stubEnv("MODEL_API_KEY", "");
    vi.stubEnv("OPEN_WEIGHTS_BASE_URL", "");
    vi.stubEnv("OPEN_WEIGHTS_MODEL", "");
    vi.stubEnv("OPEN_WEIGHTS_PROVIDER", "baseten");
    vi.stubEnv("BASETEN_API_KEY", "fake-key-for-test");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    render(<ReportPage />);
    const option = screen.getByRole("radio", { name: /Run privately/ });
    fireEvent.click(option);
    expect(screen.getByText(/This report will run as/).textContent).toMatch(/Muse Spark Open \(open weights, served by Baseten\)/);
    expect(screen.queryByRole("radio", { name: /OpenRouter/ })).not.toBeInTheDocument();
  });
});

describe("Layout and the Muse Model License", () => {
  // The license asks every product that uses Muse Spark Open to say so in its UI.
  const footer = async () => {
    const { default: RootLayout } = await import("./layout");
    const html = renderToStaticMarkup(RootLayout({ children: <p>content</p> }));
    return html.slice(html.indexOf("<footer"));
  };

  it("says 'Built with Muse Spark Open' when the configured open-weights model is Muse Spark Open", async () => {
    vi.stubEnv("OPEN_WEIGHTS_PROVIDER", "baseten");
    vi.stubEnv("BASETEN_API_KEY", "fake-key-for-test");
    expect(await footer()).toContain("Built with Muse Spark Open.");
  });

  it("does not claim it for another model or when nothing is configured", async () => {
    vi.stubEnv("OPEN_WEIGHTS_PROVIDER", "");
    vi.stubEnv("OPEN_WEIGHTS_BASE_URL", "https://w--g.modal.run/v1");
    vi.stubEnv("OPEN_WEIGHTS_MODEL", "muse-glimmer");
    expect(await footer()).not.toContain("Built with Muse Spark Open");
    vi.stubEnv("OPEN_WEIGHTS_BASE_URL", "");
    vi.stubEnv("OPEN_WEIGHTS_MODEL", "");
    expect(await footer()).not.toContain("Built with Muse Spark Open");
  });
});
