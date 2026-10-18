import { describe, expect, it } from "vitest";
import { EMPTY_QUERY, listQueryString, parseListQuery, type ListQuery } from "./list-query";

const parsed: ListQuery = {
  status: "viewed",
  plan: "not_ready",
  from: "2026-10-01",
  to: null,
  version: 2,
  media: true,
  q: "Ana",
  page: 3,
};

describe("parseListQuery", () => {
  it("parses known values and drops the rest", () => {
    expect(
      parseListQuery({
        status: "viewed",
        plan: "not_ready",
        from: "2026-10-01",
        to: "nope",
        version: "2",
        media: "1",
        q: "  Ana  ",
        page: "3",
      }),
    ).toEqual(parsed);
    expect(parseListQuery({})).toEqual(EMPTY_QUERY);
    expect(parseListQuery({ status: "bogus", plan: "x", version: "0", media: "yes" })).toEqual(
      EMPTY_QUERY,
    );
  });

  it("takes the first of repeated values", () => {
    expect(parseListQuery({ status: ["new", "viewed"] }).status).toBe("new");
  });

  it("keeps the page at 1 or more", () => {
    expect(parseListQuery({ page: "0" }).page).toBe(1);
    expect(parseListQuery({ page: "-4" }).page).toBe(1);
    expect(parseListQuery({ page: "x" }).page).toBe(1);
  });

  it("cuts q to 100 characters and turns blank into null", () => {
    expect(parseListQuery({ q: "a".repeat(150) }).q).toBe("a".repeat(100));
    expect(parseListQuery({ q: "   " }).q).toBeNull();
  });
});

describe("listQueryString", () => {
  it("writes a canonical query string", () => {
    expect(listQueryString(EMPTY_QUERY)).toBe("");
    expect(listQueryString(parsed)).toBe(
      "?status=viewed&plan=not_ready&from=2026-10-01&version=2&media=1&q=Ana&page=3",
    );
    expect(listQueryString(parsed, { page: 1 })).toBe(
      "?status=viewed&plan=not_ready&from=2026-10-01&version=2&media=1&q=Ana",
    );
    expect(listQueryString(EMPTY_QUERY, { q: "Ana & Luz" })).toBe("?q=Ana%20%26%20Luz");
  });
});
