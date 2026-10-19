import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvLine } from "./csv";

describe("csv", () => {
  it("quotes per RFC 4180", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
    expect(csvCell("one\r\ntwo")).toBe('"one\r\ntwo"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("")).toBe("");
  });

  it("guards cells that a spreadsheet would read as a formula", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+507 0000 0000")).toBe("'+507 0000 0000");
    expect(csvCell("-3")).toBe("'-3");
    expect(csvCell("@user")).toBe("'@user");
    expect(csvCell("\tcell")).toBe("'\tcell");
    expect(csvCell("\rcell")).toBe('"\'\rcell"');
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });

  it("ends lines with CRLF", () => {
    expect(csvLine(["a", "b,c", "=1"])).toBe('a,"b,c",\'=1\r\n');
    expect(CSV_BOM).toHaveLength(1);
    expect(CSV_BOM.codePointAt(0)).toBe(0xfeff);
  });
});
