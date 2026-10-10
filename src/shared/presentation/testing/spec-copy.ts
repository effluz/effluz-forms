import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

/**
 * Every `| key | English | Spanish |` row of the copy tables in the given spec files,
 * paths relative to the repository root. Test-only: copy tests compare their copy
 * objects against the specs, which own the text.
 */
export function specCopyRows(...specPaths: string[]): Map<string, { en: string; es: string }> {
  const rows = new Map<string, { en: string; es: string }>();
  for (const specPath of specPaths) {
    const spec = readFileSync(path.join(REPO_ROOT, specPath), "utf8");
    for (const line of spec.split("\n")) {
      const cells = /^\| ([a-z_]+\.[a-z_]+) \| (.+) \| (.+) \|$/.exec(line);
      if (cells?.[1] && cells[2] && cells[3]) rows.set(cells[1], { en: cells[2], es: cells[3] });
    }
  }
  return rows;
}
