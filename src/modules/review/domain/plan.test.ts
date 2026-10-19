import { describe, expect, it } from "vitest";
import { decidePlan, plannedAfterUnpublish, publishDay, type PlanSlot } from "./plan";

const story: PlanSlot = { submissionId: "s-1", reference: "EFF-1", plannedOn: null };
const other: PlanSlot = { submissionId: "s-2", reference: "EFF-2", plannedOn: "2026-10-21" };

describe("decidePlan", () => {
  it("plans on a free day", () => {
    expect(
      decidePlan({ story, date: "2026-10-21", holder: null, resolution: null, expected: null }),
    ).toEqual({
      kind: "write",
      writes: [{ submissionId: "s-1", plannedOn: "2026-10-21" }],
    });
  });

  it("planning the day it already holds writes nothing new", () => {
    const planned = { ...story, plannedOn: "2026-10-21" };
    expect(
      decidePlan({
        story: planned,
        date: "2026-10-21",
        holder: planned,
        resolution: null,
        expected: null,
      }),
    ).toEqual({ kind: "write", writes: [{ submissionId: "s-1", plannedOn: "2026-10-21" }] });
  });

  it("asks on a taken day", () => {
    expect(
      decidePlan({ story, date: "2026-10-21", holder: other, resolution: null, expected: null }),
    ).toEqual({
      kind: "conflict",
      other,
      canSwap: false,
    });
    const planned = { ...story, plannedOn: "2026-10-20" };
    expect(
      decidePlan({
        story: planned,
        date: "2026-10-21",
        holder: other,
        resolution: null,
        expected: null,
      }),
    ).toEqual({ kind: "conflict", other, canSwap: true });
  });

  it("swap moves this story off first", () => {
    const planned = { ...story, plannedOn: "2026-10-20" };
    expect(
      decidePlan({
        story: planned,
        date: "2026-10-21",
        holder: other,
        resolution: "swap",
        expected: "EFF-2",
      }),
    ).toEqual({
      kind: "write",
      writes: [
        { submissionId: "s-1", plannedOn: null },
        { submissionId: "s-2", plannedOn: "2026-10-20" },
        { submissionId: "s-1", plannedOn: "2026-10-21" },
      ],
    });
  });

  const moveWrites = {
    kind: "write",
    writes: [
      { submissionId: "s-2", plannedOn: null },
      { submissionId: "s-1", plannedOn: "2026-10-21" },
    ],
  };

  it("move sends the other to waiting", () => {
    expect(
      decidePlan({
        story,
        date: "2026-10-21",
        holder: other,
        resolution: "move",
        expected: "EFF-2",
      }),
    ).toEqual(moveWrites);
  });

  it("asks again when a swap is asked for a story with no date to give", () => {
    expect(
      decidePlan({
        story,
        date: "2026-10-21",
        holder: other,
        resolution: "swap",
        expected: "EFF-2",
      }),
    ).toEqual({ kind: "conflict", other, canSwap: false });
  });

  it("asks again when the day's holder is not the story the planner was shown", () => {
    const planned = { ...story, plannedOn: "2026-10-20" };
    for (const resolution of ["swap", "move"] as const) {
      expect(
        decidePlan({
          story: planned,
          date: "2026-10-21",
          holder: other,
          resolution,
          expected: "EFF-3",
        }),
      ).toEqual({ kind: "conflict", other, canSwap: true });
      expect(
        decidePlan({
          story: planned,
          date: "2026-10-21",
          holder: other,
          resolution,
          expected: null,
        }),
      ).toEqual({ kind: "conflict", other, canSwap: true });
    }
  });

  it("clearing writes null", () => {
    const planned = { ...story, plannedOn: "2026-10-20" };
    expect(
      decidePlan({ story: planned, date: null, holder: null, resolution: null, expected: null }),
    ).toEqual({
      kind: "write",
      writes: [{ submissionId: "s-1", plannedOn: null }],
    });
  });
});

describe("publishDay", () => {
  it("publish day", () => {
    expect(publishDay("2026-10-21", "2026-10-18")).toBe("2026-10-21");
    expect(publishDay(null, "2026-10-18")).toBe("2026-10-18");
  });
});

describe("plannedAfterUnpublish", () => {
  it("unmark moves the story to waiting when its day was taken meanwhile", () => {
    expect(plannedAfterUnpublish({ plannedOn: "2026-10-21", dayHeldByOther: true })).toBeNull();
    expect(plannedAfterUnpublish({ plannedOn: "2026-10-21", dayHeldByOther: false })).toBe(
      "2026-10-21",
    );
    expect(plannedAfterUnpublish({ plannedOn: null, dayHeldByOther: false })).toBeNull();
  });
});
