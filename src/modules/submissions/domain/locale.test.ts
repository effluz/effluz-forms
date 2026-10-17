import { describe, expect, it } from "vitest";
import { localeFor, pickLocale } from "./locale";

describe("locale choice", () => {
  it("uses the form's only language, else the browser's preference, else Spanish", () => {
    expect(pickLocale("en", "es-PA,es;q=0.9")).toBe("en");
    expect(pickLocale("es", "en-US")).toBe("es");
    expect(pickLocale("bilingual", "fr-FR,en-US;q=0.8,es;q=0.5")).toBe("en");
    expect(pickLocale("bilingual", "es;q=0.4,en;q=0.9")).toBe("en");
    expect(pickLocale("bilingual", "de, fr")).toBe("es");
    expect(pickLocale("bilingual", null)).toBe("es");
  });

  it("ignores languages the browser refuses with q=0, and keeps header order on ties", () => {
    expect(pickLocale("bilingual", "en;q=0, es")).toBe("es");
    expect(pickLocale("bilingual", "EN-gb, es")).toBe("en");
    expect(pickLocale("bilingual", "es, en")).toBe("es");
  });

  it("keeps a wanted locale only when the form offers it", () => {
    expect(localeFor("bilingual", "en")).toBe("en");
    expect(localeFor("es", "en")).toBe("es");
    expect(localeFor("en", "en")).toBe("en");
  });
});
