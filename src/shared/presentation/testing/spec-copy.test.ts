import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { specCopyRows } from "./spec-copy";

const dir = mkdtempSync(path.join(tmpdir(), "spec-copy-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function spec(name: string, rows: string[]): string {
  const file = path.join(dir, name);
  writeFileSync(file, ["| Key | English | Spanish |", "|---|---|---|", ...rows].join("\n"));
  return file;
}

describe("specCopyRows", () => {
  it("reads the key rows of every given file", () => {
    const a = spec("a.md", ["| one.key | One | Uno |"]);
    const b = spec("b.md", ["| two.key | Two | Dos |"]);
    expect(Object.fromEntries(specCopyRows(a, b))).toEqual({
      "one.key": { en: "One", es: "Uno" },
      "two.key": { en: "Two", es: "Dos" },
    });
  });

  it("refuses a key defined in more than one file", () => {
    const a = spec("c.md", ["| same.key | One | Uno |"]);
    const b = spec("d.md", ["| same.key | Other | Otro |"]);
    expect(() => specCopyRows(a, b)).toThrow(/same\.key/);
  });
});
