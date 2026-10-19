import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/modules/review/presentation/review.module.css", "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const tokens = JSON.parse(readFileSync("design-system/tokens.json", "utf8")) as {
  font: { size: { staff: Record<string, number> } };
  size: Record<string, unknown>;
};

/** The rules of the stylesheet as [selector list, body]; media queries are flattened. */
function rules(): [string[], string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [
    (selector ?? "")
      .replace(/@media[^{]*$/, "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
    body ?? "",
  ]);
}

/** [ids, classes and pseudo-classes, elements] of one selector, as CSS compares them. */
function specificity(selector: string): [number, number, number] {
  const classes = (selector.match(/\.[\w-]+|:(?!:)[\w-]+|\[[^\]]+\]/g) ?? []).length;
  const elements = (selector.match(/(?:^|[\s>+~])[a-z][a-z0-9]*/g) ?? []).length;
  return [0, classes, elements];
}

const beats = (a: [number, number, number], b: [number, number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

describe("review.module.css", () => {
  it("keeps today's row focus ring above the shell's, whatever the stylesheet order", () => {
    // `.shell a:focus-visible` in manager.module.css: a class, a pseudo-class and an element.
    const shell = specificity(".shell a:focus-visible");
    const today = rules()
      .flatMap(([selectors]) => selectors)
      .filter((selector) => selector.includes("weekToday") && selector.includes(":focus-visible"));
    expect(today.length).toBeGreaterThan(0);
    for (const selector of today) expect(beats(specificity(selector), shell)).toBe(true);
  });

  it("sets every text size from a staff font size token", () => {
    const allowed = new Set(Object.values(tokens.font.size.staff));
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(allowed.has(size), `${String(size)}px`).toBe(true);
  });

  it("sizes its icons from size tokens", () => {
    const allowed = new Set([
      tokens.size["iconDefault"],
      tokens.size["iconSmall"],
      tokens.size["iconInline"],
    ]);
    const icons = rules()
      .filter(([selectors]) => selectors.some((selector) => /Icon$/.test(selector)))
      .map(([, body]) => Number(/width:\s*(\d+)px/.exec(body)?.[1]));
    expect(icons.length).toBeGreaterThan(0);
    for (const size of icons) expect(allowed.has(size), `${String(size)}px`).toBe(true);
  });
});
