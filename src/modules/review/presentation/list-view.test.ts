import { describe, expect, it } from "vitest";
import { EMPTY_QUERY } from "../application";
import { chipHref, exportHref, listHref, storyHref } from "./list-view";

const ID = "00000001-0000-4000-8000-000000000001";

describe("list links", () => {
  it("builds list, chip and story links", () => {
    expect(listHref(ID, EMPTY_QUERY)).toBe(`/admin/forms/${ID}`);
    expect(listHref(ID, { ...EMPTY_QUERY, q: "ana lópez", page: 2 })).toBe(
      `/admin/forms/${ID}?q=ana%20l%C3%B3pez&page=2`,
    );
    expect(chipHref(ID, { ...EMPTY_QUERY, page: 3 }, { status: "new" })).toBe(
      `/admin/forms/${ID}?status=new`,
    );
    expect(chipHref(ID, { ...EMPTY_QUERY, status: "new", page: 3 }, { status: "new" })).toBe(
      `/admin/forms/${ID}`,
    );
    expect(chipHref(ID, { ...EMPTY_QUERY, status: "new" }, { plan: "waiting" })).toBe(
      `/admin/forms/${ID}?status=new&plan=waiting`,
    );
    expect(storyHref(ID, "HP-0042", { ...EMPTY_QUERY, status: "new", page: 2 })).toBe(
      `/admin/forms/${ID}/submissions/HP-0042?status=new&page=2`,
    );
    expect(storyHref(ID, "HP-0042", EMPTY_QUERY)).toBe(`/admin/forms/${ID}/submissions/HP-0042`);
  });

  it("opens the export dialog on top of the current filters", () => {
    expect(exportHref(ID, EMPTY_QUERY)).toBe(`/admin/forms/${ID}?export=1`);
    expect(exportHref(ID, { ...EMPTY_QUERY, status: "edited", page: 2 })).toBe(
      `/admin/forms/${ID}?status=edited&page=2&export=1`,
    );
  });
});
