import { describe, expect, it } from "vitest";
import { decidePlan, plannedAfterUnpublish, publishDay, type PlanSlot } from "./plan";

const story: PlanSlot = { submissionId: "s-1", reference: "EFF-1", plannedOn: null };
const other: PlanSlot = { submissionId: "s-2", reference: "EFF-2", plannedOn: "2026-10-21" };

describe("decidePlan", () => {
  it("plans on a free day", () => {
    expect(decidePlan({ story, date: "2026-10-21", holder: null, resolution: null })).toEqual({
      kind: "write",
      writes: [{ submissionId: "s-1", plannedOn: "2026-10-21" }],
    });
  });

  it("writes the same date when the story already holds the day", () => {
    const planned = { ...story, plannedOn: "2026-10-21" };
    expect(
      decidePlan({ story: planned, date: "2026-10-21", holder: planned, resolution: null }),
    ).toEqual({ kind: "write", writes: [{ submissionId: "s-1", plannedOn: "2026-10-21" }] });
  });

  it("asks on a taken day", () => {
    expect(decidePlan({ story, date: "2026-10-21", holder: other, resolution: null })).toEqual({
      kind: "conflict",
      other,
      canSwap: false,
    });
    const planned = { ...story, plannedOn: "2026-10-20" };
    expect(
      decidePlan({ story: planned, date: "2026-10-21", holder: other, resolution: null }),
    ).toEqual({ kind: "conflict", other, canSwap: true });
  });

  it("swaps by moving this story off first", () => {
    const planned = { ...story, plannedOn: "2026-10-20" };
    expect(
      decidePlan({ story: planned, date: "2026-10-21", holder: other, resolution: "swap" }),
    ).toEqual({
      kind: "write",
      writes: [
        { submissionId: "s-1", plannedOn: null },
        { submissionId: "s-2", plannedOn: "2026-10-20" },
        { submissionId: "s-1", plannedOn: "2026-10-21" },
      ],
    });
  });

  it("sends the other story to waiting on a move, and treats a swap of an unplanned story as a move", () => {
    const expected = {
      kind: "write",
      writes: [
        { submissionId: "s-2", plannedOn: null },
        { submissionId: "s-1", plannedOn: "2026-10-21" },
      ],
    };
    expect(decidePlan({ story, date: "2026-10-21", holder: other, resolution: "move" })).toEqual(
      expected,
    );
    expect(decidePlan({ story, date: "2026-10-21", holder: other, resolution: "swap" })).toEqual(
      expected,
    );
  });

  it("clears the day by writing null", () => {
    const planned = { ...story, plannedOn: "2026-10-20" };
    expect(decidePlan({ story: planned, date: null, holder: null, resolution: null })).toEqual({
      kind: "write",
      writes: [{ submissionId: "s-1", plannedOn: null }],
    });
  });
});

describe("publishDay", () => {
  it("is the planned date, or today when unplanned", () => {
    expect(publishDay("2026-10-21", "2026-10-18")).toBe("2026-10-21");
    expect(publishDay(null, "2026-10-18")).toBe("2026-10-18");
  });
});

describe("plannedAfterUnpublish", () => {
  it("moves the story to waiting when its day was taken meanwhile", () => {
    expect(plannedAfterUnpublish({ plannedOn: "2026-10-21", dayHeldByOther: true })).toBeNull();
    expect(plannedAfterUnpublish({ plannedOn: "2026-10-21", dayHeldByOther: false })).toBe(
      "2026-10-21",
    );
    expect(plannedAfterUnpublish({ plannedOn: null, dayHeldByOther: false })).toBeNull();
  });
});
