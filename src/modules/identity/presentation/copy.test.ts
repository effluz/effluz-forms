import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copy, fill } from "./copy";

/** Every `| key | English | Spanish |` row of the manager spec's copy tables. */
function specRows(): Map<string, { en: string; es: string }> {
  const spec = readFileSync(path.resolve(__dirname, "../../../../specs/ui-ux/manager.md"), "utf8");
  const rows = new Map<string, { en: string; es: string }>();
  for (const line of spec.split("\n")) {
    const cells = /^\| ([a-z_]+\.[a-z_]+) \| (.+) \| (.+) \|$/.exec(line);
    if (cells?.[1] && cells[2] && cells[3]) rows.set(cells[1], { en: cells[2], es: cells[3] });
  }
  return rows;
}

describe("copy", () => {
  it("matches the rows of the manager spec, which owns the text", () => {
    const rows = specRows();
    for (const [key, text] of Object.entries(copy)) {
      expect({ key, ...rows.get(key) }).toEqual({ key, ...text });
    }
  });
});

describe("fill", () => {
  it("replaces known placeholders and leaves unknown ones", () => {
    expect(fill("Signed in as {name}", { name: "Staff Member" })).toBe("Signed in as Staff Member");
    expect(fill("{count} jobs", {})).toBe("{count} jobs");
  });
});
