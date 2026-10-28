import { describe, expect, it } from "vitest";
import { languageName } from "@/components/format";
import { isLanguageCode, SUPPORTED_LANGUAGES, supportedLanguageName } from "./languages";
import { SYSTEM_PROMPT } from "./agent/system-prompt";

describe("supported languages", () => {
  it("are English, French, German, Spanish and Italian, English first", () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toEqual(["en", "fr", "de", "es", "it"]);
    expect(SUPPORTED_LANGUAGES.map((l) => l.name)).toEqual(["English", "French", "German", "Spanish", "Italian"]);
  });

  it("recognise a code and name it, whatever its case or padding", () => {
    expect(isLanguageCode("de")).toBe(true);
    expect(isLanguageCode("DE")).toBe(false); // a code is lowercase; callers lowercase what they read
    expect(isLanguageCode("nl")).toBe(false);
    expect(isLanguageCode(undefined)).toBe(false);
    expect(supportedLanguageName(" De ")).toBe("German");
    expect(supportedLanguageName("nl")).toBeUndefined();
  });

  it("show on the case page as a name, and fall back to the upper-cased code for another language", () => {
    expect(languageName("de")).toBe("German");
    expect(languageName("it")).toBe("Italian");
    expect(languageName("nl")).toBe("NL");
  });

  it("are told to the agent, which is to send a message that is clearly in another language to a person", () => {
    expect(SYSTEM_PROMPT).toMatch(/"Reply language" line/);
    for (const name of ["English", "French", "German", "Spanish", "Italian"]) expect(SYSTEM_PROMPT).toContain(name);
    expect(SYSTEM_PROMPT).toMatch(/clearly written in another language, write the reply in English and set needsHuman to true/);
    // The guardrail reads dates and amounts in the five languages only: the prompt says why other ones go to a person.
    expect(SYSTEM_PROMPT).toMatch(/checks amounts and dates only in those five languages/);
  });
});
