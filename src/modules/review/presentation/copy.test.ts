import { describe, expect, it } from "vitest";
import { specCopyRows } from "@/shared/presentation/testing/spec-copy";
import { reviewCopy, both } from "./copy";

const placeholders = (text: string) => [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).sort();

describe("review copy", () => {
  const rows = specCopyRows("specs/ui-ux/manager.md", "specs/ui-ux/builder.md");

  it("matches the rows of the manager spec", () => {
    for (const [key, text] of Object.entries(reviewCopy)) {
      expect({ key, ...rows.get(key) }).toEqual({ key, ...text });
    }
  });

  it("binds every row of the groups review owns", () => {
    // The `pub.` group is shared with builder.md, which owns the publish dialog's rows; the
    // manager spec alone holds the nine rows review owns.
    const owned = /^(sub|st|pub|del|ex|plan|ops)\./;
    const managerRows = specCopyRows("specs/ui-ux/manager.md");
    const expected = [...managerRows.keys()].filter((key) => owned.test(key)).sort();
    expect(Object.keys(reviewCopy).sort()).toEqual(expected);
  });

  it("has no placeholder whose value would differ by language", () => {
    for (const [key, text] of Object.entries(reviewCopy)) {
      expect({ key, names: placeholders(text.en) }).toEqual({ key, names: placeholders(text.es) });
    }
  });

  it("joins both languages for attributes and fills the placeholders", () => {
    expect(both("st.back")).toBe("Back to the list / Volver a la lista");
    expect(both("st.version", { n: "2" })).toBe("Version 2 / Versión 2");
    expect(both("ops.never")).toBe("Never / Nunca");
  });
});
