import { describe, expect, it } from "vitest";
import {
  isComplete,
  localizedTextFrom,
  localizedTextSchema,
  requiredLocales,
  resolveText,
} from "./localized-text";

describe("requiredLocales", () => {
  it("returns both for bilingual and one otherwise", () => {
    expect(requiredLocales("bilingual")).toEqual(["en", "es"]);
    expect(requiredLocales("es")).toEqual(["es"]);
  });
});

describe("isComplete", () => {
  it("needs every required locale non-blank", () => {
    expect(isComplete({ en: "Name", es: "Nombre" }, "bilingual")).toBe(true);
    expect(isComplete({ en: "Name", es: "  " }, "bilingual")).toBe(false);
    expect(isComplete({ es: "Nombre" }, "es")).toBe(true);
    expect(isComplete(undefined, "es")).toBe(false);
  });
});

describe("resolveText", () => {
  it("prefers the requested locale and falls back to the other required one", () => {
    const t = localizedTextFrom("Name", "Nombre");
    expect(resolveText(t, "es", "bilingual")).toBe("Nombre");
    expect(resolveText({ en: "Name" }, "es", "bilingual")).toBe("Name");
    expect(resolveText({}, "es", "es")).toBe("");
  });
});

describe("localizedTextSchema", () => {
  it("rejects non-string values and overlong strings", () => {
    expect(localizedTextSchema.safeParse({ en: 1 }).success).toBe(false);
    expect(localizedTextSchema.safeParse({ en: "x".repeat(20_001) }).success).toBe(false);
    expect(localizedTextSchema.safeParse({}).success).toBe(true);
  });
});
