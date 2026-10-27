// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeEngine } from "@/lib/config";
import { DEMO_SCENARIOS } from "./demo-scenarios";
import { ReportForm } from "./report-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => "/report" }));

const NONE = { museKey: false, openWeights: false };

const image = (name = "vase.jpg", type = "image/jpeg", size = 2000) =>
  new File([new Uint8Array(size)], name, { type });

function fill(order: string, email: string, message: string) {
  fireEvent.change(screen.getByLabelText("Order number"), { target: { value: order } });
  fireEvent.change(screen.getByLabelText("E-mail used for the order"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Message from the customer"), { target: { value: message } });
}

function attach(...files: File[]) {
  fireEvent.change(screen.getByLabelText(/Photos of the damage/), { target: { files } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));
}

beforeEach(() => {
  push.mockReset();
  let n = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:photo-${n++}`, revokeObjectURL: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe("report form validation", () => {
  it("blocks an empty submission, explains each problem and calls nothing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportForm availability={NONE} />);
    submit();

    expect(screen.getByText("Enter the order number from the confirmation e-mail.")).toBeInTheDocument();
    expect(screen.getByText("Enter the e-mail address used for the order.")).toBeInTheDocument();
    expect(screen.getByText("Describe what happened in a few words.")).toBeInTheDocument();
    expect(screen.getByText("Attach at least one photo of the damage.")).toBeInTheDocument();
    expect(screen.getByLabelText("Order number")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Order number")).toHaveFocus(); // focus goes to the first problem
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a bad e-mail", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ReportForm availability={NONE} />);
    fill("#1001", "not-an-email", "My vase is broken");
    attach(image());
    submit();
    expect(screen.getByText("Enter a valid e-mail address.")).toBeInTheDocument();
  });

  it("refuses a 4th photo, a wrong type and a file over 8 MB as soon as they are picked", () => {
    render(<ReportForm availability={NONE} />);
    attach(image("a.jpg"), image("b.jpg"), image("c.jpg"));
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.getByLabelText(/Photos of the damage/)).toBeDisabled(); // full

    // Remove one, then try a PDF and an oversized photo
    fireEvent.click(screen.getByRole("button", { name: /Remove photo 3/ }));
    expect(screen.getAllByRole("img")).toHaveLength(2);
    attach(image("doc.pdf", "application/pdf"));
    expect(screen.getByRole("alert")).toHaveTextContent(/not a JPEG, PNG or WebP/);
    fireEvent.click(screen.getByRole("button", { name: /Remove photo 3/ }));
    attach(image("huge.jpg", "image/jpeg", 8 * 1024 * 1024 + 1));
    expect(screen.getByRole("alert")).toHaveTextContent(/larger than 8 MB/);
  });

  it("says what it will really run as: demo mode when there is no key", () => {
    render(<ReportForm availability={NONE} />);
    expect(screen.getByRole("radio", { name: /Muse Spark 1\.3 \(Model API\)/ })).toBeChecked();
    expect(screen.getByText(/This report will run as/).textContent).toMatch(/DEMO MODE: deterministic mock, not Muse/);
    expect(screen.getByText(/the requested engine is not configured on this server/)).toBeInTheDocument();
  });

  it("names Muse when the server has a key, and the private engine when it is configured", () => {
    render(<ReportForm availability={{ museKey: true, openWeights: true }} />);
    expect(screen.getByText(/This report will run as/).textContent).toMatch(/Muse Spark 1\.3 \(Meta Model API\)/);
    fireEvent.click(screen.getByRole("radio", { name: /Run privately \(open weights\)/ }));
    expect(screen.getByText(/This report will run as/).textContent).toMatch(/Open weights \(private run\)/);
    fireEvent.click(screen.getByRole("radio", { name: /Demo mode/ }));
    expect(screen.getByText(/This report will run as/).textContent).toMatch(/DEMO MODE/);
  });
});

describe("report form: Baseten and the test engine", () => {
  it("names the model and host that the private run will really use", () => {
    const detail = describeEngine("open-weights", { OPEN_WEIGHTS_PROVIDER: "baseten", BASETEN_API_KEY: "placeholder" });
    render(<ReportForm availability={{ museKey: true, openWeights: true, openWeightsDetail: detail }} />);
    fireEvent.click(screen.getByRole("radio", { name: /Run privately \(open weights\)/ }));
    expect(screen.getByText(/This report will run as/).textContent).toMatch(/Muse Spark Open \(open weights, served by Baseten\)/);
  });

  it("shows the OpenRouter test engine only when the server has its key", () => {
    const { unmount } = render(<ReportForm availability={{ museKey: true, openWeights: false }} />);
    expect(screen.queryByRole("radio", { name: /OpenRouter/ })).not.toBeInTheDocument();
    unmount();
    render(
      <ReportForm
        availability={{ museKey: true, openWeights: false, openRouter: true, openRouterDetail: describeEngine("openrouter", {}) }}
      />,
    );
    expect(screen.getByRole("radio", { name: /Muse Spark 1\.3 \(Model API\)/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /OpenRouter/ }));
    expect(screen.getByText(/This report will run as/).textContent).toMatch(/via OpenRouter \(test engine, not private\)/);
  });
});

describe("report form submission", () => {
  it("posts multipart data and opens the new case", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ caseId: "case-9" }) }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportForm availability={NONE} />);
    fill(" #1001 ", "camille@example.com", "My vase arrived broken");
    attach(image("vase.jpg"));
    fireEvent.click(screen.getByRole("radio", { name: /Demo mode/ }));
    submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/cases/case-9"));
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const [url, init] = calls[0];
    expect(url).toBe("/api/reports");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("orderNumber")).toBe("#1001");
    expect(body.get("email")).toBe("camille@example.com");
    expect(body.get("engine")).toBe("demo-mock");
    expect(body.get("language")).toBeNull(); // "detect from the message"
    expect(body.getAll("photos")).toHaveLength(1);
  });

  it("shows field errors and the message returned by the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ message: "The report is not valid.", fields: { orderNumber: "Server says no." } }),
      }) as Response),
    );
    render(<ReportForm availability={NONE} />);
    fill("#1001", "camille@example.com", "My vase arrived broken");
    attach(image());
    submit();
    expect(await screen.findByText("Server says no.")).toBeInTheDocument();
    expect(screen.getByText("The report is not valid.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("links to the saved case when the agent failed but the report was kept", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ message: "The agent could not process this report.", caseId: "case-7" }),
      }) as Response),
    );
    render(<ReportForm availability={NONE} />);
    fill("#1001", "camille@example.com", "My vase arrived broken");
    attach(image());
    submit();
    expect(await screen.findByText("The agent could not process this report.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the saved case" })).toHaveAttribute("href", "/cases/case-7");
  });

  it("explains a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<ReportForm availability={NONE} />);
    fill("#1001", "camille@example.com", "My vase arrived broken");
    attach(image());
    submit();
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send report" })).toBeEnabled();
  });
});

describe("demo case buttons", () => {
  it("offers the six demo cases", () => {
    render(<ReportForm availability={NONE} />);
    expect(screen.getByRole("heading", { name: "Demo cases" })).toBeInTheDocument();
    for (const s of DEMO_SCENARIOS) expect(screen.getByRole("button", { name: new RegExp(s.title) })).toBeInTheDocument();
    expect(DEMO_SCENARIOS).toHaveLength(6);
  });

  it("fills the form and attaches the photo, using the illustration while the real photo is missing", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("/api/demo-photo")
        ? ({ ok: false } as Response)
        : ({ ok: true, blob: async () => new Blob([new Uint8Array(10)], { type: "image/png" }) } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportForm availability={NONE} />);
    fireEvent.click(screen.getByRole("button", { name: /Parcel opened, item missing/ }));

    await screen.findByText(/Demo case loaded: Parcel opened, item missing/);
    expect(screen.getByLabelText("Order number")).toHaveValue("#1004");
    expect((screen.getByLabelText("Message from the customer") as HTMLTextAreaElement).value).toContain("Bonjour");
    expect(screen.getByLabelText("Customer language")).toHaveValue("fr");
    expect(screen.getByAltText(/Attached photo 1: illustration-opened-parcel\.png/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/demo-photo?name=parcel-open-missing",
      "/demo/illustration-opened-parcel.png",
    ]);
  });

  it("prefers the demo photo served by the server when it exists, and names the file after its real type", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, blob: async () => new Blob([new Uint8Array(10)], { type: "image/jpeg" }) }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportForm availability={NONE} />);
    fireEvent.click(screen.getByRole("button", { name: /Broken vase/ }));
    await screen.findByText(/Demo case loaded/);
    expect(screen.getByAltText(/vase-broken\.jpg/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("access code on a public deployment", () => {
  const PUBLIC = { museKey: true, openWeights: false, accessCodeRequired: true };
  // The code is remembered for the tab: a test that typed one must not leave it to the next.
  beforeEach(() => window.sessionStorage.clear());

  it("tells the judges, above the form, to use the access code, and what happens without it", () => {
    render(<ReportForm availability={PUBLIC} />);
    const notice = screen.getByTestId("access-code-notice");
    expect(notice).toHaveTextContent("Judges: use the access code from the submission to run the real agent.");
    expect(notice).toHaveTextContent(/accepts no new report, not even in demo mode/);
    expect(within(notice).getByRole("link", { name: "Cases page" })).toHaveAttribute("href", "/");
    // Above the fields, not after them.
    expect(notice.compareDocumentPosition(screen.getByLabelText("Order number")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no notice on a local run", () => {
    render(<ReportForm availability={NONE} />);
    expect(screen.queryByTestId("access-code-notice")).not.toBeInTheDocument();
  });

  it("says nothing is accepted without the code, then which engine runs once it is typed", () => {
    render(<ReportForm availability={PUBLIC} />);
    expect(screen.getByLabelText("Access code")).toBeInTheDocument();
    expect(screen.getByText(/nothing is accepted until you enter the access code/)).toBeInTheDocument();
    // No engine is named yet: "Needs the access code", not a DEMO MODE badge.
    expect(screen.getByTestId("needs-access-code")).toHaveTextContent("Needs the access code");
    expect(screen.getByText(/This report will run as/).textContent).not.toMatch(/DEMO MODE/);
    fireEvent.change(screen.getByLabelText("Access code"), { target: { value: "judges-2026" } });
    expect(screen.getByText(/This report will run as/).textContent).toMatch(/Muse Spark/);
    expect(screen.queryByText(/nothing is accepted/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("needs-access-code")).not.toBeInTheDocument();
  });

  it("does not send a report without the code: it says so and moves to the code field", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportForm availability={PUBLIC} />);
    fill("#1001", "camille.laurent@example.com", "My vase arrived broken");
    attach(image());
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/access code from the submission/);
    expect(screen.getByLabelText("Access code")).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the code with the report", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ caseId: "c1" }) }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportForm availability={PUBLIC} />);
    fireEvent.change(screen.getByLabelText("Access code"), { target: { value: "judges-2026" } });
    fill("#1001", "camille.laurent@example.com", "My vase arrived broken");
    attach(image());
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["x-access-code"]).toBe("judges-2026");
  });

  it("has no access-code field on a local run", () => {
    render(<ReportForm availability={NONE} />);
    expect(screen.queryByLabelText("Access code")).not.toBeInTheDocument();
  });
});
