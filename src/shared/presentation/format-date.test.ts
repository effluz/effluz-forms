import { describe, expect, it } from "vitest";
import { formatDate } from "./format-date";

describe("formatDate", () => {
  it("formats a date in the time zone, labelled with it, and in UTC", () => {
    expect(formatDate("2026-10-09T14:30:00Z", "America/Panama")).toEqual({
      local: "2026-10-09 09:30 America/Panama",
      utc: "2026-10-09 14:30 UTC",
    });
    expect(formatDate(new Date("2026-01-01T00:05:00Z"), "UTC")).toEqual({
      local: "2026-01-01 00:05 UTC",
      utc: "2026-01-01 00:05 UTC",
    });
  });
});
