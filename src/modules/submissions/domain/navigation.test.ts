import { describe, expect, it } from "vitest";
import {
  firstPageKey,
  nextPageKey,
  pagePosition,
  previousPageKey,
  visiblePageKeys,
} from "./navigation";
import { registry, storyVersion } from "./testing/versions";

describe("page navigation", () => {
  it("skips a hidden page in both directions and in the count", () => {
    const v = storyVersion();
    const no = { f_baby: "no_opt" };
    const yes = { f_baby: "yes_opt" };
    expect(firstPageKey(v, registry)).toBe("page_contact");
    expect(nextPageKey(v, no, registry, "page_contact")).toBe("page_consent");
    expect(nextPageKey(v, yes, registry, "page_contact")).toBe("page_baby");
    expect(previousPageKey(v, no, registry, "page_consent")).toBe("page_contact");
    expect(nextPageKey(v, {}, registry, "page_consent")).toBeNull();
    expect(pagePosition(v, no, registry, "page_consent")).toEqual({ n: 2, total: 2 });
    expect(pagePosition(v, yes, registry, "page_consent")).toEqual({ n: 3, total: 3 });
  });

  it("lists the visible page keys in document order", () => {
    const v = storyVersion();
    expect(visiblePageKeys(v, { f_baby: "yes_opt" }, registry)).toEqual([
      "page_contact",
      "page_baby",
      "page_consent",
    ]);
    expect(visiblePageKeys(v, { f_baby: "no_opt" }, registry)).toEqual([
      "page_contact",
      "page_consent",
    ]);
  });

  it("has no page before the first, and counts a page that just became hidden", () => {
    const v = storyVersion();
    const no = { f_baby: "no_opt" };
    expect(previousPageKey(v, no, registry, "page_contact")).toBeNull();
    expect(previousPageKey(v, { f_baby: "yes_opt" }, registry, "page_consent")).toBe("page_baby");
    expect(pagePosition(v, no, registry, "page_baby")).toEqual({ n: 2, total: 3 });
    expect(nextPageKey(v, no, registry, "page_baby")).toBe("page_consent");
  });
});
