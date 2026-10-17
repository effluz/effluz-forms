import { describe, expect, it } from "vitest";
import { specTableRows } from "../testing/spec-copy";
import { confirmationParts, fillTemplate, staffParts } from "./copy";

describe("email copy", () => {
  it("matches the confirmation email's fixed parts in renderer.md, both languages", () => {
    const rows = specTableRows("specs/ui-ux/renderer.md", "Confirmation email, fixed parts");
    expect(Object.fromEntries([...rows].map(([k, [en, es]]) => [k, { en, es }]))).toEqual(
      confirmationParts,
    );
  });

  it("matches the staff notification's fixed parts in email.md", () => {
    const rows = specTableRows("specs/system/email.md", "Staff notification, fixed parts");
    expect(Object.fromEntries([...rows].map(([k, [en]]) => [k, en]))).toEqual(staffParts);
  });

  it("fills placeholders with spaces in their names and leaves unknown ones", () => {
    expect(
      fillTemplate("{form title}: {ref} {x}", { "form title": "Stories", ref: "HP-0001" }),
    ).toBe("Stories: HP-0001 {x}");
  });

  it("fills in one pass, so a value that looks like a placeholder stays as written", () => {
    expect(fillTemplate("{ref} {form title}", { ref: "{form title}", "form title": "T" })).toBe(
      "{form title} T",
    );
  });
});
