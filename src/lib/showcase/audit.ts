import { inflateSync } from "node:zlib";
import type { FixtureOrder } from "../orders/fixtures";
import type { CaseRecord } from "../types";
import { SHOWCASE_PATH_PREFIX } from "./showcase";

// What must be true of a showcase case before it is committed to a public repository and
// served from a public URL. Used by scripts/build-showcase.ts when the folder is built and by
// a test every time the suite runs, so a recording that slips something in fails CI.
//
// The data is supposed to be fictitious end to end: the orders come from
// data/fixtures/orders.json (invented people, example.* e-mails), the photos are the
// provisional stand-ins of data/photos/. These checks do not prove that; they refuse the
// obvious ways it could stop being true (a real-looking address, a key in a trace, a path
// from someone's machine).

// example.com/.org/.net, and the ".example" TLD, are reserved for documentation (RFC 2606): the
// demo merchant is claims@maison-demo.example. None of them can be a real mailbox.
const FICTITIOUS_EMAIL = /@(?:[A-Za-z0-9-]+\.)*example(?:\.(?:com|org|net))?$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, "an API-key-like string (sk-...)"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i, "a bearer token"],
  [/vercel_blob_rw_/i, "a Vercel Blob token"],
  [/(MODEL_API_KEY|OPENROUTER_API_KEY|BLOB_READ_WRITE_TOKEN|OPEN_WEIGHTS_(API_KEY|PROXY_KEY|PROXY_SECRET)|SHOPIFY_ADMIN_ACCESS_TOKEN|DAMAGE_DESK_ACCESS_CODE)/, "the name of a secret variable"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, "a JWT"],
];

// Run on text that is real prose or JSON strings, not on PDF bytes (where compressed or hex
// runs would look like tokens). A slash ends a run, so a long path is not a token.
const LONG_TOKEN: [RegExp, string] = [/[A-Za-z0-9+_=-]{40,}/, "a long token-like string"];

const LOCAL_PATTERNS: [RegExp, string][] = [
  [/\/Users\/|\/home\/[a-z]|[A-Za-z]:\\\\/, "a path from a developer's machine"],
  [/data\/runtime/, "a path in the git-ignored runtime folder"],
  [/contributor/i, "a Contributor-mode model id (Meta would train on that traffic)"],
];

/** Every e-mail address that carries a public business contact in the carrier rules. */
export function carrierEmails(carriersJsonText: string): Set<string> {
  return new Set((carriersJsonText.match(EMAIL) ?? []).map((e) => e.toLowerCase()));
}

export interface AuditContext {
  fixtures: FixtureOrder[];
  /** Business addresses that are allowed because data/carriers.json publishes them. */
  allowedEmails: Set<string>;
  /** Does this showcase-relative file ("data/showcase/...") exist? */
  fileExists: (logicalPath: string) => boolean;
}

/** Text that must pass the same checks whether it comes from a case or from a PDF. */
export function auditText(text: string, allowedEmails: Set<string>, options: { longTokens?: boolean } = {}): string[] {
  const problems: string[] = [];
  for (const email of text.match(EMAIL) ?? []) {
    if (!FICTITIOUS_EMAIL.test(email) && !allowedEmails.has(email.toLowerCase())) {
      problems.push(`e-mail address that is neither example.com/.org/.net nor a carrier contact: ${email}`);
    }
  }
  // URLs (carrier terms) are long and harmless: keep them out of the token-like check.
  const withoutUrls = text.replace(/https?:\/\/\S+/g, " ");
  const secrets = options.longTokens === false ? SECRET_PATTERNS : [...SECRET_PATTERNS, LONG_TOKEN];
  for (const [pattern, what] of secrets) {
    if (pattern.test(withoutUrls)) problems.push(`contains ${what}`);
  }
  for (const [pattern, what] of LOCAL_PATTERNS) {
    if (pattern.test(text)) problems.push(`contains ${what}`);
  }
  return [...new Set(problems)];
}

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}

/** Every file a case points to: the customer's photos, the annotated ones, the claim PDF. */
export function referencedFiles(c: CaseRecord): string[] {
  return [
    ...c.report.photos,
    ...c.evidence.flatMap((e) => [e.photo, ...(e.annotatedPhoto ? [e.annotatedPhoto] : [])]),
    ...(c.document ? [c.document.pdfPath] : []),
  ];
}

/** Problems found in one showcase case, empty when it is fit to publish. */
export function auditShowcaseCase(c: CaseRecord, context: AuditContext): string[] {
  const problems: string[] = [];
  if (c.engine !== "muse-spark-1.3") problems.push(`engine is "${c.engine}", a showcase case must be a real Muse Spark 1.3 run`);
  if (!c.recorded?.recordedOn) problems.push("no `recorded.recordedOn`");

  // The strings of the case, not its JSON text: a "\n" escape must not glue an "n" onto the
  // e-mail address that follows it.
  problems.push(...auditText(allStrings(c).join("\n"), context.allowedEmails));

  if (c.order) {
    const fixture = context.fixtures.find((f) => f.id === c.order?.id);
    if (!fixture) {
      problems.push(`order ${c.order.id} is not in data/fixtures/orders.json`);
    } else {
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      for (const field of ["name", "email", "carrier", "service", "trackingNumber", "weightKg", "currency", "lineItems", "shippingAddress"] as const) {
        if (!same(c.order[field], fixture[field])) problems.push(`order ${c.order.id}: "${field}" differs from the fixture`);
      }
    }
  }

  for (const file of referencedFiles(c)) {
    if (!file.startsWith(SHOWCASE_PATH_PREFIX)) problems.push(`file outside ${SHOWCASE_PATH_PREFIX}: ${file}`);
    else if (!context.fileExists(file)) problems.push(`missing file: ${file}`);
  }
  return problems;
}

/** pdf-lib writes every drawn string as a hex string, `<4361...> Tj`: decode them (WinAnsi, close enough to latin1 here). */
function decodeHexStrings(content: string): string {
  return content.replace(/<([0-9A-Fa-f\s]{2,})>/g, (whole, hex: string) => {
    const digits = hex.replace(/\s+/g, "");
    return digits.length % 2 === 0 ? `${Buffer.from(digits, "hex").toString("latin1")}\n` : whole;
  });
}

/**
 * The text a PDF draws, as far as a plain scan can tell: every Flate-compressed stream is
 * inflated, its hex strings are decoded, and the uncompressed part (document info) is kept as
 * is. Enough to catch an e-mail, a path or a key; not a PDF parser.
 */
export function pdfText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  const parts: string[] = [raw.replace(/stream[\s\S]*?endstream/g, " ")];
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = streams.exec(raw); m; m = streams.exec(raw)) {
    try {
      parts.push(decodeHexStrings(inflateSync(Buffer.from(m[1], "latin1")).toString("latin1")));
    } catch {
      // not a Flate stream (an image): nothing readable to scan
    }
  }
  return parts.join("\n");
}
