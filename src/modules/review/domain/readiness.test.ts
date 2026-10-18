import { describe, expect, it } from "vitest";
import { NO_CHECKS, editedStale, readiness, withChoice, type StoryChecks } from "./readiness";

const T = new Date("2026-10-18T12:00:00Z");
const full: StoryChecks = { chosen: ["a"], photosEditedFor: ["a"], textCheckedAt: T };

describe("readiness", () => {
  it("is ready only with all three", () => {
    expect(readiness(full)).toEqual({
      photosChosen: true,
      photosEdited: true,
      textChecked: true,
      ready: true,
      done: 3,
    });
    const noPhotos = readiness({ ...full, chosen: [], photosEditedFor: [] });
    expect(noPhotos.ready).toBe(false);
    expect(noPhotos.photosChosen).toBe(false);
    expect(noPhotos.done).toBe(1);
    const noEdit = readiness({ ...full, photosEditedFor: null });
    expect(noEdit.ready).toBe(false);
    expect(noEdit.done).toBe(2);
    const noText = readiness({ ...full, textCheckedAt: null });
    expect(noText.ready).toBe(false);
    expect(noText.textChecked).toBe(false);
    expect(noText.done).toBe(2);
    expect(readiness(NO_CHECKS).done).toBe(0);
  });

  it("counts photos edited only for the same chosen set", () => {
    const stale: StoryChecks = { chosen: ["a", "b"], photosEditedFor: ["a"], textCheckedAt: T };
    expect(readiness(stale).photosEdited).toBe(false);
    expect(editedStale(stale)).toBe(true);
    const empty: StoryChecks = { chosen: [], photosEditedFor: [], textCheckedAt: null };
    const r = readiness(empty);
    expect(r.photosChosen).toBe(false);
    expect(r.photosEdited).toBe(false);
    expect(editedStale(empty)).toBe(false);
    expect(editedStale(NO_CHECKS)).toBe(false);
    expect(editedStale(full)).toBe(false);
  });

  it("withChoice adds and removes, keeping the set sorted and unique", () => {
    expect(withChoice(["b"], "a", true)).toEqual(["a", "b"]);
    expect(withChoice(["a", "b"], "a", true)).toEqual(["a", "b"]);
    expect(withChoice(["a", "b"], "a", false)).toEqual(["b"]);
    expect(withChoice(["b"], "a", false)).toEqual(["b"]);
  });
});
