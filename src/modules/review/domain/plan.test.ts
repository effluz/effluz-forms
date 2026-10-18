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

  it("planning the day it already holds writes nothing new", () => {
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

  it("swap moves this story off first", () => {
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

  const moveWrites = {
    kind: "write",
    writes: [
      { submissionId: "s-2", plannedOn: null },
      { submissionId: "s-1", plannedOn: "2026-10-21" },
    ],
  };

  it("move sends the other to waiting", () => {
    expect(decidePlan({ story, date: "2026-10-21", holder: other, resolution: "move" })).toEqual(
      moveWrites,
    );
  });

  it("treats a swap asked for an unplanned story as a move", () => {
    expect(decidePlan({ story, date: "2026-10-21", holder: other, resolution: "swap" })).toEqual(
      moveWrites,
    );
  });

  it("clearing writes null", () => {
    const planned = { ...story, plannedOn: "2026-10-20" };
    expect(decidePlan({ story: planned, date: null, holder: null, resolution: null })).toEqual({
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
