import { describe, expect, it } from "vitest";
import { SECTION_HEADER, sectionFromHeader, sectionOf } from "./sections";

describe("sectionOf", () => {
  it.each([
    ["/admin/plan", "plan"],
    ["/admin/plan?week=x", "plan"],
    ["/admin/plan/", "plan"],
    ["/admin/operations", "operations"],
    ["/admin/operations/retry", "operations"],
    ["/admin/audit", "audit"],
    ["/admin/forms", "forms"],
    ["/admin/forms/1/submissions/HP-0001", "forms"],
    ["/admin/planner", "forms"],
    ["/admin/operationsx", "forms"],
    ["/admin", "forms"],
  ] as const)("reads %s as %s", (path, section) => {
    expect(sectionOf(path)).toBe(section);
  });
});

describe("sectionFromHeader", () => {
  it("accepts the four sections and reads anything else as Forms", () => {
    expect(SECTION_HEADER).toBe("x-effluz-section");
    for (const section of ["forms", "plan", "operations", "audit"] as const)
      expect(sectionFromHeader(section)).toBe(section);
    expect(sectionFromHeader(null)).toBe("forms");
    expect(sectionFromHeader("")).toBe("forms");
    expect(sectionFromHeader("settings")).toBe("forms");
    expect(sectionFromHeader("PLAN")).toBe("forms");
  });
});
