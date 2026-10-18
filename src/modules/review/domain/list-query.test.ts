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

  it("cuts a long search without splitting a character", () => {
    const q = parseListQuery({ q: `${"a".repeat(99)}\u{1F600}` }).q;
    expect(q).toBe(`${"a".repeat(99)}\u{1F600}`);
    const query = parseListQuery({ q: q ?? undefined });
    expect(() => listQueryString(query)).not.toThrow();
    expect(parseListQuery(Object.fromEntries(new URLSearchParams(listQueryString(query))))).toEqual(
      query,
    );
    const cut = parseListQuery({ q: `${"a".repeat(99)}\u{1F600}\u{1F600}` }).q;
    expect(Array.from(cut ?? "")).toHaveLength(100);
    expect(() => encodeURIComponent(cut ?? "")).not.toThrow();
  });

  it("replaces a lone surrogate so the query string never throws", () => {
    const parsedLone = parseListQuery({ q: "ab\uD83D" });
    expect(parsedLone.q).toBe("ab\uFFFD");
    expect(() => listQueryString(EMPTY_QUERY, { q: "x\uDE00y\uD83D" })).not.toThrow();
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
