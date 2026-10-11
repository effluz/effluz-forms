import { describe, expect, it } from "vitest";
import { validationCodes } from "@/shared/domain/form-model";
import { specTableRows } from "@/shared/presentation/testing/spec-copy";
import { catalog, chrome, isOne, t } from "./copy";

const asText = (rows: Map<string, string[]>) =>
  Object.fromEntries([...rows].map(([key, [en, es]]) => [key, { en, es }]));

describe("renderer copy", () => {
  it("binds every row of the fixed chrome copy in renderer.md, which owns the text", () => {
    expect(chrome).toEqual(asText(specTableRows("specs/ui-ux/renderer.md", "Fixed chrome copy")));
  });

  it("binds every row of the message catalog", () => {
    expect(catalog).toEqual(asText(specTableRows("specs/ui-ux/renderer.md", "Message catalog")));
  });

  it("has a catalog row for every validation code and every file refusal", () => {
    for (const code of [
      ...validationCodes,
      "file_too_large",
      "file_wrong_type",
      "file_unreadable",
      "upload_failed",
      "submission_too_large",
    ]) {
      expect(Object.hasOwn(catalog, code.replaceAll("_", " ")), code).toBe(true);
    }
  });

  it("fills placeholders in the chosen language", () => {
    expect(t("es", "progress", { n: "2", total: "5" })).toBe("Página 2 de 5");
    expect(t("en", "skip_link")).toBe("Skip to form");
  });

  it("follows each language's plural rules for one", () => {
    expect(isOne("en", 1)).toBe(true);
    expect(isOne("es", 1)).toBe(true);
    expect(isOne("en", 0)).toBe(false);
    expect(isOne("es", 2)).toBe(false);
  });
});
