// The languages a customer can write in, with the reply written in the same one (Europe lot,
// 28 Oct 2026: German, Spanish and Italian next to English and French). One list, used by the
// language guess (src/app/api/_lib/language.ts), the report form, the voice recorder, the speech-to-text
// bias and the prompt, so a new language is added here once. A code outside it still works: the
// form sends it as is and the agent follows the language of the message (system-prompt.ts).

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && SUPPORTED_LANGUAGES.some((l) => l.code === value);
}

/** English name of a supported language ("de" gives "German"), undefined for any other code. */
export function supportedLanguageName(code: string): string | undefined {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code.trim().toLowerCase())?.name;
}
