import { describe, expect, it } from "vitest";
import { specCopyRows } from "@/shared/presentation/testing/spec-copy";
import { copy } from "./copy";

describe("copy", () => {
  it("matches the rows of the manager spec, which owns the text", () => {
    const rows = specCopyRows("specs/ui-ux/manager.md");
    for (const [key, text] of Object.entries(copy)) {
      expect({ key, ...rows.get(key) }).toEqual({ key, ...text });
    }
  });

  it("holds exactly the sign-in pages' copy; the shell's is shared", () => {
    const authRows = [...specCopyRows("specs/ui-ux/manager.md").keys()].filter((key) =>
      key.startsWith("auth."),
    );
    expect(Object.keys(copy).sort()).toEqual(authRows.sort());
  });
});
