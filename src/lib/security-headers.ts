// Security headers of every response, set in next.config.ts. Kept in a file of its own (no
// imports) so a test can read the policy and so each directive has its reason next to it.
//
// This is a STATIC policy on purpose. A strict one (nonce + 'strict-dynamic') would need a
// proxy.ts that mints a nonce per request; it fits this app (every page is dynamic) but it
// could not be built or tried in a browser when this was written (27 Oct 2026, `next build` did
// not run in the working copy), and a CSP that is wrong blanks the whole app. So the one thing
// a static policy cannot do is kept out: scripts may be inline ('unsafe-inline'), which Next.js
// needs for the data it streams into the page. Everything else is closed. To tighten it later:
// docs in node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.

export interface Header {
  key: string;
  value: string;
}

/** The Content-Security-Policy of the pages and the API. `dev` is `next dev`: it needs eval and a websocket. */
export function contentSecurityPolicy({ dev = false }: { dev?: boolean } = {}): string {
  const directives: Record<string, string[]> = {
    // Whatever is not listed below is limited to this origin.
    "default-src": ["'self'"],
    // 'unsafe-inline': Next.js writes inline <script> tags (the streamed page data) that a static
    // policy cannot allow one by one. No eval in production; React's dev tooling uses it in dev.
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    // 'unsafe-inline': React and Tailwind set style attributes (the spinner, the progress bar).
    "style-src": ["'self'", "'unsafe-inline'"],
    // blob: is the preview of a photo before it is sent (URL.createObjectURL); data: because a
    // case can hold a photo as a data URL (components/photo-src.ts). Stored photos come from
    // our own /api/files and /api/demo-photo routes.
    "img-src": ["'self'", "data:", "blob:"],
    // System font stack: nothing is downloaded, 'self' covers a font added to /public later.
    "font-src": ["'self'"],
    // fetch() only talks to our own /api routes (the model is called from the server, never from
    // the browser). `next dev` also needs its hot-reload websocket.
    "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
    // The microphone itself is not a CSP matter (Permissions-Policy below); the recording is
    // sent as a file. blob: / 'self' only, in case a page ever plays a clip back.
    "media-src": ["'self'", "blob:"],
    // The claim PDF is shown in an iframe from this origin.
    "frame-src": ["'self'"],
    // No plugins (<object>, <embed>), no <base> tag rewriting every relative URL, forms only to us.
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // Nobody may frame the app (clickjacking). The PDF route overrides this, see pdfFrameHeaders.
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/** Sent on every route. */
export function securityHeaders({ dev = false }: { dev?: boolean } = {}): Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy({ dev }) },
    // Case ids and file paths travel in URLs of this site: another site gets the origin only (and
    // nothing at all on a downgrade to http), never the full address.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // A JSON error or an uploaded file must never be sniffed into HTML or a script.
    { key: "X-Content-Type-Options", value: "nosniff" },
    // The voice message needs the microphone, on this origin only; nothing uses the camera.
    { key: "Permissions-Policy", value: "microphone=(self), camera=()" },
    // Older browsers ignore frame-ancestors; this is its twin.
    { key: "X-Frame-Options", value: "DENY" },
  ];
}

/**
 * The claim PDF (/api/cases/[id]/pdf) is the one response the app frames itself, in the case
 * page. It overrides the two framing headers, and its CSP is reduced to frame-ancestors on
 * purpose: a PDF has no scripts or sub-resources, and a restrictive default-src or object-src on
 * the PDF itself is known to stop some browsers' built-in PDF viewer from rendering it in a
 * frame (not tried here, so the safe minimum is kept).
 */
export function pdfFrameHeaders(): Header[] {
  return [
    { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
  ];
}
