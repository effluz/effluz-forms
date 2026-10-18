import type { IsoDate } from "./days";

/** One story as the plan sees it: at most one story holds a day. */
export interface PlanSlot {
  submissionId: string;
  reference: string;
  plannedOn: IsoDate | null;
}

export type PlanResolution = "swap" | "move";

export type PlanDecision =
  | { kind: "write"; writes: { submissionId: string; plannedOn: IsoDate | null }[] }
  | { kind: "conflict"; other: PlanSlot; canSwap: boolean };

/**
 * Decides how to set `story` on `date` (null clears it) given who holds that day.
 * The writes come in the order they must run, so the one-story-per-day index never trips.
 */
export function decidePlan(input: {
  story: PlanSlot;
  date: IsoDate | null;
  holder: PlanSlot | null;
  resolution: PlanResolution | null;
}): PlanDecision {
  const { story, date, holder, resolution } = input;
  if (date === null) {
    return { kind: "write", writes: [{ submissionId: story.submissionId, plannedOn: null }] };
  }
  if (holder === null || holder.submissionId === story.submissionId) {
    return { kind: "write", writes: [{ submissionId: story.submissionId, plannedOn: date }] };
  }
  if (resolution === null) {
    return { kind: "conflict", other: holder, canSwap: story.plannedOn !== null };
  }
  if (resolution === "swap" && story.plannedOn !== null) {
    return {
      kind: "write",
      writes: [
        { submissionId: story.submissionId, plannedOn: null },
        { submissionId: holder.submissionId, plannedOn: story.plannedOn },
        { submissionId: story.submissionId, plannedOn: date },
      ],
    };
  }
  return {
    kind: "write",
    writes: [
      { submissionId: holder.submissionId, plannedOn: null },
      { submissionId: story.submissionId, plannedOn: date },
    ],
  };
}

/** The day a story counts as published on. */
export function publishDay(plannedOn: IsoDate | null, today: IsoDate): IsoDate {
  return plannedOn ?? today;
}

/** The planned date after Unmark: kept when it had one and the day is free, else null. */
export function plannedAfterUnpublish(input: {
  plannedOn: IsoDate | null;
  dayHeldByOther: boolean;
}): IsoDate | null {
  return input.dayHeldByOther ? null : input.plannedOn;
}
