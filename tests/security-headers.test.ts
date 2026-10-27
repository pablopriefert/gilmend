import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { contentSecurityPolicy, pdfFrameHeaders, securityHeaders } from "../src/lib/security-headers";

// What the browser is told about every response. The policy itself cannot be tried in a browser
// from a test: these tests pin what the app needs (so a tightening does not blank it) and what
// must stay closed (so a loosening is noticed).

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

const header = (list: { key: string; value: string }[], key: string) => list.find((h) => h.key === key)?.value;

describe("Content-Security-Policy", () => {
  const csp = directives(contentSecurityPolicy());

  it("keeps everything on this origin unless a directive says more", () => {
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual(["'self'"]);
    expect(csp["font-src"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
  });

  it("lets the pages work: Next's inline scripts, inline styles, photo previews, the PDF iframe", () => {
    expect(csp["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    // blob: = the preview of a photo before it is sent; data: = a case photo stored as a data URL.
    expect(csp["img-src"]).toEqual(expect.arrayContaining(["'self'", "blob:", "data:"]));
    expect(csp["frame-src"]).toEqual(["'self'"]);
    expect(csp["media-src"]).toEqual(expect.arrayContaining(["'self'"]));
  });

  it("allows no remote script, no eval, no plugin and no framing by another site in production", () => {
    const all = contentSecurityPolicy();
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
    expect(all).not.toMatch(/https?:/);
    expect(all).not.toContain("*");
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
  });

  it("only `next dev` gets eval and a websocket (hot reload)", () => {
    const dev = directives(contentSecurityPolicy({ dev: true }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toEqual(expect.arrayContaining(["'self'", "ws:"]));
  });
});

describe("security headers", () => {
  const list = securityHeaders();

  it("sets the four headers the review asked for", () => {
    expect(header(list, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header(list, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(list, "Permissions-Policy")).toBe("microphone=(self), camera=()");
    expect(header(list, "Content-Security-Policy")).toBe(contentSecurityPolicy());
  });

  it("keeps the microphone for the voice report and switches the camera off", () => {
    const permissions = header(list, "Permissions-Policy")!;
    expect(permissions).toMatch(/microphone=\(self\)/);
    expect(permissions).toMatch(/camera=\(\)/);
  });

  it("denies framing everywhere, with the legacy header as the twin of frame-ancestors", () => {
    expect(header(list, "X-Frame-Options")).toBe("DENY");
  });

  it("sends no header twice", () => {
    const keys = list.map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the claim PDF, framed by the case page", () => {
  it("is the only response that may be framed, and only by this origin", () => {
    const pdf = pdfFrameHeaders();
    expect(header(pdf, "Content-Security-Policy")).toBe("frame-ancestors 'self'");
    expect(header(pdf, "X-Frame-Options")).toBe("SAMEORIGIN");
  });
});

describe("next.config headers()", () => {
  it("applies the policy to every route, then relaxes framing for the PDF route only", async () => {
    const rules = await nextConfig.headers!();
    expect(rules.map((r) => r.source)).toEqual(["/:path*", "/api/cases/:id/pdf"]);
    expect(rules[0].headers).toEqual(securityHeaders());
    // Later rules win for a key both set (Next.js docs, "Header Overriding Behavior"), so the PDF
    // rule must come after the general one.
    expect(rules[1].headers).toEqual(pdfFrameHeaders());
    const keysOfPdf = rules[1].headers.map((h) => h.key);
    for (const key of keysOfPdf) expect(rules[0].headers.map((h) => h.key)).toContain(key);
  });
});
