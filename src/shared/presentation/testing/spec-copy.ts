import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

/**
 * Every `| key | English | Spanish |` row of the copy tables in the given spec files,
 * paths relative to the repository root (or absolute). Test-only: copy tests compare their copy
 * objects against the specs, which own the text. A key defined in more than one of
 * the files is an error, since the text would have two owners.
 */
export function specCopyRows(...specPaths: string[]): Map<string, { en: string; es: string }> {
  const rows = new Map<string, { en: string; es: string }>();
  const owner = new Map<string, string>();
  for (const specPath of specPaths) {
    const spec = readFileSync(path.resolve(REPO_ROOT, specPath), "utf8");
    for (const line of spec.split("\n")) {
      const cells = /^\| ([a-z_]+\.[a-z_]+) \| (.+) \| (.+) \|$/.exec(line);
      if (!cells?.[1] || !cells[2] || !cells[3]) continue;
      const first = owner.get(cells[1]);
      if (first !== undefined && first !== specPath) {
        throw new Error(`Copy key ${cells[1]} is defined in both ${first} and ${specPath}`);
      }
      owner.set(cells[1], specPath);
      rows.set(cells[1], { en: cells[2], es: cells[3] });
    }
  }
  return rows;
}

/**
 * The first table under the `##` to `####` heading with this text, keyed by each row's first
 * cell, the other cells as the value. For tables whose keys are not `group.name`, such as the
 * renderer's fixed chrome copy and message catalog. Test-only; throws when the heading or its
 * table is missing, so a renamed heading fails the copy test instead of passing vacuously.
 */
export function specTableRows(specPath: string, heading: string): Map<string, string[]> {
  const lines = readFileSync(path.resolve(REPO_ROOT, specPath), "utf8").split("\n");
  const isHeading = (line: string) => /^#{1,6} /.test(line);
  const start = lines.findIndex(
    (line) => /^#{2,4} /.test(line) && line.replace(/^#+ /, "").trim() === heading,
  );
  if (start === -1) throw new Error(`No heading "${heading}" in ${specPath}`);

  const rows = new Map<string, string[]>();
  let index = start + 1;
  while (
    index < lines.length &&
    !isHeading(lines[index] ?? "") &&
    !(lines[index] ?? "").startsWith("|")
  ) {
    index += 1;
  }
  if (!(lines[index] ?? "").startsWith("|")) {
    throw new Error(`No table under heading "${heading}" in ${specPath}`);
  }
  index += 2; // the header row and the separator row
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("|")) break;
    const cells = line
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
    const [key, ...values] = cells;
    if (key) rows.set(key, values);
  }
  return rows;
}
