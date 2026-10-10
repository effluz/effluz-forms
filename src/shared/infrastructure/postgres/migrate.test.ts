import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrate";

describe("loadMigrations", () => {
  it("orders by numeric id across directories and parses names", () => {
    const a = mkdtempSync(path.join(tmpdir(), "mig-a-"));
    const b = mkdtempSync(path.join(tmpdir(), "mig-b-"));
    writeFileSync(path.join(a, "0002_second.sql"), "select 2;");
    writeFileSync(path.join(b, "0001_first.sql"), "select 1;");
    writeFileSync(path.join(b, "notes.md"), "ignored");
    expect(loadMigrations([a, b]).map((m) => [m.id, m.name])).toEqual([
      ["0001", "first"],
      ["0002", "second"],
    ]);
  });

  it("rejects a duplicate id", () => {
    const a = mkdtempSync(path.join(tmpdir(), "mig-a-"));
    const b = mkdtempSync(path.join(tmpdir(), "mig-b-"));
    writeFileSync(path.join(a, "0001_x.sql"), "");
    writeFileSync(path.join(b, "0001_y.sql"), "");
    expect(() => loadMigrations([a, b])).toThrow(/duplicate migration id 0001/);
  });

  it("rejects a malformed file name", () => {
    const a = mkdtempSync(path.join(tmpdir(), "mig-a-"));
    writeFileSync(path.join(a, "1_bad.sql"), "");
    expect(() => loadMigrations([a])).toThrow(/1_bad.sql/);
  });
});
