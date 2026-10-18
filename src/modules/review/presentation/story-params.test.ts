import { describe, expect, it } from "vitest";
import { EMPTY_QUERY } from "../application";
import { parseStoryParams, storyPath } from "./story-params";

const ID = "00000001-0000-4000-8000-000000000001";

/** The query string of a path as the record a page receives. */
function paramsOf(path: string): Record<string, string> {
  const search = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  return Object.fromEntries(new URLSearchParams(search));
}

describe("story params", () => {
  it("parses known values only", () => {
    const parsed = parseStoryParams({
      action: "explode",
      done: "celebrated",
      error: "on_fire",
      conflict_date: "2026-10-21",
      n: "0",
    });
    expect(parsed.action).toBeNull();
    expect(parsed.done).toBeNull();
    expect(parsed.error).toBeNull();
    expect(parsed.conflict).toBeNull();
    expect(parsed.n).toBeNull();
    expect(parseStoryParams({ n: "-3" }).n).toBeNull();
    expect(parseStoryParams({ n: "2.5" }).n).toBeNull();
    expect(parseStoryParams({ n: "3" }).n).toBe(3);
    expect(
      parseStoryParams({ conflict_date: "2026-02-30", conflict_ref: "ST-0002" }).conflict,
    ).toBeNull();
    expect(
      parseStoryParams({ conflict_date: "2026-10-21", conflict_ref: "ST-0002", conflict_swap: "1" })
        .conflict,
    ).toEqual({ date: "2026-10-21", ref: "ST-0002", canSwap: true });
    expect(
      parseStoryParams({ conflict_date: "2026-10-21", conflict_ref: "ST-0002" }).conflict,
    ).toEqual({ date: "2026-10-21", ref: "ST-0002", canSwap: false });
    const known = parseStoryParams({
      action: "delete",
      done: "unpublished_waiting",
      error: "reference_mismatch",
      other: "ST-0002",
      edit: "",
    });
    expect(known.action).toBe("delete");
    expect(known.done).toBe("unpublished_waiting");
    expect(known.error).toBe("reference_mismatch");
    expect(known.other).toBe("ST-0002");
    expect(known.edit).toBeNull();
    expect(known.query).toEqual(EMPTY_QUERY);
  });

  it("round-trips through storyPath", () => {
    const query = { ...EMPTY_QUERY, status: "new" as const };
    const path = storyPath(ID, "ST-0001", query, { edit: "f_name" });
    expect(path).toBe(`/admin/forms/${ID}/submissions/ST-0001?status=new&edit=f_name`);
    const parsed = parseStoryParams(paramsOf(path));
    expect(parsed.query).toEqual(query);
    expect(parsed.edit).toBe("f_name");
    expect(storyPath(ID, "ST-0001", parsed.query, { edit: parsed.edit })).toBe(path);

    const every = storyPath(ID, "ST-0001", EMPTY_QUERY, {
      compare: "f_story",
      action: "revert",
      field: "f_story",
      conflict: { date: "2026-10-21", ref: "ST-0002", canSwap: true },
      done: "photos_added",
      error: "file_too_large",
      n: 2,
      other: "ST-0003",
    });
    const back = parseStoryParams(paramsOf(every));
    expect(back).toEqual({
      query: EMPTY_QUERY,
      edit: null,
      compare: "f_story",
      photo: null,
      action: "revert",
      field: "f_story",
      media: null,
      conflict: { date: "2026-10-21", ref: "ST-0002", canSwap: true },
      done: "photos_added",
      error: "file_too_large",
      n: 2,
      other: "ST-0003",
    });
    expect(storyPath(ID, "ST-0001", EMPTY_QUERY)).toBe(`/admin/forms/${ID}/submissions/ST-0001`);
  });
});
