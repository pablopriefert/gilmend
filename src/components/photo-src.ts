// Turns whatever a case stores as a "photo" into something an <img> can load.
// Cases keep file paths under data/runtime/ (uploads, annotated evidence) or data URLs.
// Files on disk are served by GET /api/files, which only ever reads inside data/runtime/ and
// data/showcase/.
// Pure string logic (no node:path) so client components can import it too.

const RUNTIME_MARKER = "data/runtime/";
// The committed, read-only recorded runs (src/lib/showcase). /api/files serves them under the
// virtual folder "showcase/".
const SHOWCASE_MARKER = "data/showcase/";

export function photoSrc(photo: string): string {
  const p = photo.trim();
  if (p === "") return "";
  if (/^data:image\/(png|jpe?g|webp|gif);/i.test(p)) return p;
  if (/^https?:\/\//i.test(p)) return p;

  const normalized = p.replaceAll("\\", "/");
  const at = normalized.indexOf(RUNTIME_MARKER);
  if (at !== -1) {
    const relative = normalized.slice(at + RUNTIME_MARKER.length);
    return `/api/files?p=${encodeURIComponent(relative)}`;
  }
  const showcaseAt = normalized.indexOf(SHOWCASE_MARKER);
  if (showcaseAt !== -1) {
    const relative = normalized.slice(showcaseAt + SHOWCASE_MARKER.length);
    return `/api/files?p=${encodeURIComponent(`showcase/${relative}`)}`;
  }
  // On Vercel the runtime folder is <os tmp dir>/damage-desk (see src/lib/runtime-dir.ts) and
  // cases store absolute paths there. Without this branch they fell through to the "/" rule
  // below and the browser asked for "/tmp/damage-desk/uploads/..." as a static asset (404).
  const inTmp = /\/damage-desk\/((?:uploads|evidence|claims)\/.+)$/.exec(normalized);
  if (inTmp) return `/api/files?p=${encodeURIComponent(inTmp[1])}`;
  // A demo photo referenced in place (cases made by `npm run demo` or `npm run real` keep
  // "data/photos/vase-broken.webp"): /api/demo-photo serves it by name, never by path, and
  // answers 404 for any name outside the six demo photos.
  const demo = /(?:^|\/)data\/photos\/([a-z-]+)\.(?:jpe?g|webp|png)$/.exec(normalized);
  if (demo) return `/api/demo-photo?name=${encodeURIComponent(demo[1])}`;
  // Static assets shipped with the app (public/demo/...).
  if (normalized.startsWith("public/")) return `/${normalized.slice("public/".length)}`;
  if (normalized.startsWith("/")) return normalized;
  return "";
}
