/** Lets spreadsheet apps read the file as UTF-8. */
export const CSV_BOM = String.fromCodePoint(0xfeff);

/** The most rows one export writes. */
export const EXPORT_ROW_CAP = 10_000;

const FORMULA_STARTS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * One RFC 4180 cell. A value a spreadsheet would read as a formula gets a leading `'` first,
 * then the cell is quoted when it holds a comma, a quote or a line break.
 */
export function csvCell(value: string): string {
  const guarded = value !== "" && FORMULA_STARTS.has(value.charAt(0)) ? `'${value}` : value;
  return /[,"\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function csvLine(cells: readonly string[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}
