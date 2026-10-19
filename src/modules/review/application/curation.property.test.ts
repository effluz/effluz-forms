import { describe, expect, it } from "vitest";
import { revertCorrection, saveCorrection } from "./curation";
import { OWNER, seedStory } from "./testing/fixtures";
import { makeReviewDeps } from "./testing/fakes";

// mulberry32: a small seeded generator so the steps are the same on every run.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "Ana",
  "Prueba",
  "nació",
  "nacio",
  "en",
  "el",
  "hospital",
  "pequeña",
  "fuerte",
  "luchó",
  "cada",
  "día",
  "mamá",
  "¡gracias!",
  "¿cómo?",
];

const STEPS = 300;

describe("curation keeps the original", () => {
  it("the original stays byte-identical after any edits and reverts", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps, { status: "viewed" });
    const stored = () => {
      const row = deps.submissions.submissions.rows.get(submissionId);
      if (!row) throw new Error("seeded story is missing");
      return row;
    };
    const original = stored().answers.f_name;
    if (typeof original !== "string") throw new Error("seeded name is not text");
    const captured = JSON.stringify(stored().answers);
    const random = mulberry32(20261018);
    const pick = <T>(items: readonly T[]): T => {
      const item = items[Math.floor(random() * items.length)];
      if (item === undefined) throw new Error("empty pick");
      return item;
    };
    const target = { formId, reference: "ST-0001", fieldKey: "f_name" };

    for (let step = 0; step < STEPS; step++) {
      const roll = random();
      if (roll < 0.35) {
        await revertCorrection(deps, OWNER, target);
      } else if (roll < 0.45) {
        await saveCorrection(deps, OWNER, { ...target, text: original });
      } else if (roll < 0.5) {
        await saveCorrection(deps, OWNER, { ...target, text: pick(["", "  ", "\n\t"]) });
      } else if (roll < 0.55) {
        await saveCorrection(deps, OWNER, { ...target, text: "x".repeat(5001) });
      } else {
        const count = 1 + Math.floor(random() * 6);
        const text = Array.from({ length: count }, () => pick(WORDS)).join(" ");
        await saveCorrection(deps, OWNER, { ...target, text });
      }

      expect(JSON.stringify(stored().answers)).toBe(captured);
      const curation = deps.submissions.submissions.curation.get(submissionId);
      const corrected = Object.keys(curation?.curatedAnswers ?? {}).length > 0;
      expect(curation?.status === "edited").toBe(corrected);
    }
  });
});
