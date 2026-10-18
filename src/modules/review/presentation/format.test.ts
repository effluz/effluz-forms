import { describe, expect, it } from "vitest";
import { dayText, shortDay } from "./format";

describe("dayText", () => {
  it("names a day in both languages", () => {
    expect(dayText("2026-10-19")).toEqual({
      en: "Monday 19 October 2026",
      es: "lunes, 19 de octubre de 2026",
    });
    expect(dayText("2027-01-01")).toEqual({
      en: "Friday 1 January 2027",
      es: "viernes, 1 de enero de 2027",
    });
  });

  it("is not moved by the machine's time zone around month ends", () => {
    expect(dayText("2026-03-01").en).toBe("Sunday 1 March 2026");
    expect(dayText("2028-02-29").es).toBe("martes, 29 de febrero de 2028");
  });
});

describe("shortDay", () => {
  it("is the calendar date as written", () => {
    expect(shortDay("2026-10-19")).toBe("2026-10-19");
  });
});
