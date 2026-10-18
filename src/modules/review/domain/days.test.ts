import { describe, expect, it } from "vitest";
import { addDays, mondayOf, parseIsoDate, todayIn, weekDays } from "./days";

describe("days", () => {
  it("parses only real dates", () => {
    expect(parseIsoDate("2026-02-29")).toBeNull();
    expect(parseIsoDate("2028-02-29")).toBe("2028-02-29");
    expect(parseIsoDate("2026-1-5")).toBeNull();
    expect(parseIsoDate("1999-12-31")).toBeNull();
    expect(parseIsoDate("2101-01-01")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("not a date")).toBeNull();
  });

  it("finds today in Panama", () => {
    expect(todayIn("America/Panama", new Date("2026-10-19T04:30:00Z"))).toBe("2026-10-18");
    expect(todayIn("America/Panama", new Date("2026-10-19T05:30:00Z"))).toBe("2026-10-19");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });

  it("lists seven days", () => {
    const days = weekDays("2026-12-28");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-12-28");
    expect(days[6]).toBe("2027-01-03");
  });
});
