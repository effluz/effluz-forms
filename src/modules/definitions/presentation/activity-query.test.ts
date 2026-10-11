import { describe, expect, it } from "vitest";
import { ACTIVITY_PAGE_SIZE, activityFilter } from "./activity-query";

const ID = "00000001-0000-4000-8000-000000000001";

describe("activityFilter", () => {
  it("reads the actor, action and cursor, with the fixed page size", () => {
    expect(
      activityFilter({
        actor: " staff.member@example.com ",
        action: "form_published",
        before: "2026-10-09T14:30:00.000Z",
        beforeId: ID,
      }),
    ).toEqual({
      actorEmail: "staff.member@example.com",
      action: "form_published",
      before: new Date("2026-10-09T14:30:00.000Z"),
      beforeId: ID,
      limit: ACTIVITY_PAGE_SIZE,
    });
  });

  it("ignores blank filters and takes the first of a repeated parameter", () => {
    expect(activityFilter({ actor: "", action: ["a", "b"] })).toEqual({
      action: "a",
      limit: ACTIVITY_PAGE_SIZE,
    });
  });

  it("ignores a before that is not a date, and the id that goes with it", () => {
    expect(activityFilter({ before: "yesterday", beforeId: ID })).toEqual({
      limit: ACTIVITY_PAGE_SIZE,
    });
    expect(activityFilter({ before: "", beforeId: ID })).toEqual({ limit: ACTIVITY_PAGE_SIZE });
  });

  it("ignores a beforeId that is not a UUID, and one without a before", () => {
    const before = "2026-10-09T14:30:00.000Z";
    for (const beforeId of ["", "abc", `${ID}x`, "1; drop table audit_log", "-1"]) {
      expect(activityFilter({ before, beforeId })).toEqual({
        before: new Date(before),
        limit: ACTIVITY_PAGE_SIZE,
      });
    }
    expect(activityFilter({ beforeId: ID })).toEqual({ limit: ACTIVITY_PAGE_SIZE });
  });

  it("does not read a limit from the query: a page is always the same size", () => {
    for (const limit of ["1", "199", "0", "-5", "1e9", "NaN", "Infinity", "abc", "20.5", ""]) {
      expect(activityFilter({ limit }).limit).toBe(ACTIVITY_PAGE_SIZE);
    }
  });
});
