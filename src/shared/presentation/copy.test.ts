import { describe, expect, it } from "vitest";
import { bothLanguages, copy, fill } from "./copy";
import { specCopyRows } from "./testing/spec-copy";

describe("copy", () => {
  const rows = specCopyRows("specs/ui-ux/manager.md", "specs/ui-ux/builder.md");

  it("matches the rows of the manager and builder specs, which own the text", () => {
    for (const [key, text] of Object.entries(copy)) {
      expect({ key, ...rows.get(key) }).toEqual({ key, ...text });
    }
  });

  it("binds every row of the groups the manager chrome owns", () => {
    const owned = /^(nav|shell|home|form|life|set|sh|au|new)\.|^builder\.placeholder$/;
    const expected = [...rows.keys()].filter((key) => owned.test(key)).sort();
    expect(Object.keys(copy).sort()).toEqual(expected);
  });

  it("carries the copy for the builder placeholder and a refused lifecycle action", () => {
    expect(copy["builder.placeholder"].en).toBe(
      "The builder is coming soon. Settings and sharing already work.",
    );
    expect(copy["form.error_transition"].es).toBe(
      "Esa acción ya no está disponible para este formulario. Recarga para ver su estado actual.",
    );
  });
});

describe("fill", () => {
  it("replaces known placeholders and leaves unknown ones", () => {
    expect(fill("Signed in as {name}", { name: "Staff Member" })).toBe("Signed in as Staff Member");
    expect(fill("{count} jobs", {})).toBe("{count} jobs");
  });
});

describe("bothLanguages", () => {
  it("joins English and Spanish, filled, and gives identical text once", () => {
    expect(bothLanguages(copy["shell.signed_in_as"], { name: "Staff Member" })).toBe(
      "Signed in as Staff Member / Sesión iniciada como Staff Member",
    );
    expect(bothLanguages(copy["shell.wordmark"])).toBe("Effluz");
  });
});
