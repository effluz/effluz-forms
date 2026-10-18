import { describe, expect, it } from "vitest";
import { changeCount, wordDiff, type DiffPart } from "./word-diff";

const original = (parts: readonly DiffPart[]) =>
  parts
    .filter((p) => p.kind !== "added")
    .map((p) => p.text)
    .join("");
const corrected = (parts: readonly DiffPart[]) =>
  parts
    .filter((p) => p.kind !== "removed")
    .map((p) => p.text)
    .join("");

// mulberry32: a small seeded generator so the random pairs are the same on every run.
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCABULARY = [
  "Nació",
  "nacio",
  "en",
  "el",
  "hospital",
  "con",
  "poco",
  "peso",
  "pero",
  "fuerte",
  "mi",
  "hija",
  "luchó",
  "cada",
  "día",
  "y",
  "hoy",
  "está",
  "casa",
  "gracias",
  "a",
  "todos.",
  "¡Gracias!",
];
const SEPARATORS = [" ", " ", " ", "  ", "\n", " \t"];

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

function sentence(random: () => number): string {
  const length = 3 + Math.floor(random() * 12);
  let text = "";
  for (let i = 0; i < length; i += 1) {
    text += pick(VOCABULARY, random);
    if (i < length - 1) text += pick(SEPARATORS, random);
  }
  return text;
}

describe("word diff", () => {
  it("finds no change in equal texts", () => {
    const parts = wordDiff("Una historia.", "Una historia.");
    expect(parts).toEqual([{ kind: "same", text: "Una historia." }]);
    expect(changeCount(parts)).toBe(0);
  });

  it("marks a replaced word as one change", () => {
    const parts = wordDiff("Nacio en el hospital", "Nació en el hospital");
    expect(parts).toEqual([
      { kind: "removed", text: "Nacio" },
      { kind: "added", text: "Nació" },
      { kind: "same", text: " en el hospital" },
    ]);
    expect(changeCount(parts)).toBe(1);
  });

  it("keeps insertions and deletions apart", () => {
    const parts = wordDiff("a b c", "a c d");
    expect(parts).toEqual([
      { kind: "same", text: "a " },
      { kind: "removed", text: "b " },
      { kind: "same", text: "c" },
      { kind: "added", text: " d" },
    ]);
    expect(changeCount(parts)).toBe(2);
  });

  it("puts removals before additions inside one changed stretch", () => {
    const parts = wordDiff("x a y b z", "x c y d z");
    expect(parts.map((p) => p.kind)).toEqual([
      "same",
      "removed",
      "added",
      "same",
      "removed",
      "added",
      "same",
    ]);
    expect(changeCount(parts)).toBe(2);
  });

  it("handles empty sides", () => {
    expect(wordDiff("", "")).toEqual([]);
    expect(wordDiff("", "hola")).toEqual([{ kind: "added", text: "hola" }]);
    expect(wordDiff("hola", "")).toEqual([{ kind: "removed", text: "hola" }]);
  });

  it("reassembles both texts", () => {
    const random = seeded(20261018);
    for (let i = 0; i < 20; i += 1) {
      const a = sentence(random);
      const b = sentence(random);
      const parts = wordDiff(a, b);
      expect(original(parts)).toBe(a);
      expect(corrected(parts)).toBe(b);
      parts.forEach((part, index) => {
        expect(part.text).not.toBe("");
        if (index > 0) expect(part.kind).not.toBe(parts[index - 1]?.kind);
      });
    }
  });

  it("handles a 20,000-character answer quickly", () => {
    const random = seeded(7);
    const words: string[] = [];
    let size = 0;
    while (size < 20_000) {
      const word = pick(VOCABULARY, random);
      words.push(word);
      size += word.length + 1;
    }
    const base = words.join(" ");
    const edited = [...words];
    for (let i = 0; i < 10; i += 1) {
      const at = 100 + i * Math.floor(words.length / 11);
      edited[at] = `${edited[at] ?? ""}X`;
    }
    const changed = edited.join(" ");
    expect(base.length).toBeGreaterThanOrEqual(20_000);

    const started = performance.now();
    const parts = wordDiff(base, changed);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(200);
    expect(changeCount(parts)).toBe(10);
    expect(original(parts)).toBe(base);
    expect(corrected(parts)).toBe(changed);
  });

  it("still reassembles when two texts share almost nothing", () => {
    const a = Array.from({ length: 6000 }, (_, i) => `a${String(i)}`).join(" ");
    const b = Array.from({ length: 6000 }, (_, i) => `b${String(i)}`).join(" ");
    const parts = wordDiff(a, b);
    expect(original(parts)).toBe(a);
    expect(corrected(parts)).toBe(b);
  });
});
