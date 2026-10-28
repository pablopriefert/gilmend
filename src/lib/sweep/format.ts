// Dates and money as the sweep writes them, in the merchant's time zone (the same one the header
// counter uses), so the server render, the stored text and the browser agree.

const TIME_ZONE = "Europe/Paris";

/** Calendar day in Paris, "2026-10-29": the day a sweep's texts are cached for. */
export function parisDay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "Thu 29 Oct, 11:35" (Paris time). */
export function formatMoment(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "an unknown date";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  })
    .format(t)
    .replace(/^(\w+),/, "$1");
}

/** "Wed 28 Oct". */
export function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TIME_ZONE })
    .format(date)
    .replace(/^(\w+),/, "$1");
}

/** "52.90 EUR", the form the claim maths and the PDF already use. */
export function eur(amount: number): string {
  return `${(Math.round((amount + Number.EPSILON) * 100) / 100).toFixed(2)} EUR`;
}
