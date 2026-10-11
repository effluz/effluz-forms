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
