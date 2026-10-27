// Matching rules shared by the fixtures and the Shopify client. The customer types both
// values, so they are untrusted: validate before they reach a search query.

/**
 * Normalise what a customer typed ("1001", "#1001", " #1001 ") to the Shopify-style
 * "#1001". Returns null when it cannot be an order number, which makes getOrder answer
 * "not found" instead of building a search query from arbitrary text.
 */
export function normalizeOrderNumber(input: string): string | null {
  const bare = input.trim().replace(/^#\s*/, "");
  if (!/^[A-Za-z0-9-]{1,20}$/.test(bare)) return null;
  return `#${bare.toUpperCase()}`;
}

/**
 * Case-insensitive, whitespace-trimmed e-mail comparison. Deliberately no "smart"
 * normalisation (plus-aliases, dots): two addresses either match or they do not, because
 * the e-mail is what stops one customer reading another customer's order.
 */
export function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Conservative shape check; returns the trimmed address or null. */
export function normalizeEmail(input: string): string | null {
  const email = input.trim();
  if (email.length > 254) return null;
  return /^[^\s@"'\\()<>,;:]+@[^\s@"'\\()<>,;:]+\.[^\s@"'\\()<>,;:]+$/.test(email) ? email : null;
}
