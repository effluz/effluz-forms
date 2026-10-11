import { describe, expect, it } from "vitest";
import { buildDefaultRegistry } from "./field-types";
import { conditionOwners, parseDraft } from "./version";

const registry = buildDefaultRegistry();
const page = (key: string, fields: unknown[]) => ({ key, title: { en: key }, fields });
const field = (key: string, type: string, extra: Record<string, unknown> = {}) => ({
  key,
  type,
  label: { en: key },
  ...extra,
});
const draft = (pages: unknown[]) => ({
  languages: "bilingual",
  pages,
  confirmation: { screen: { en: "Thanks" } },
});

describe("parseDraft", () => {
  it("parses a title and defaults it to an empty text", () => {
    const r = parseDraft(
      { languages: "bilingual", pages: [{ key: "page1" }], confirmation: {} },
      registry,
    );
    expect(r.ok && r.version.title).toEqual({});
    const t = parseDraft(
      { languages: "en", title: { en: "Stories" }, pages: [{ key: "page1" }], confirmation: {} },
      registry,
    );
    expect(t.ok && t.version.title).toEqual({ en: "Stories" });
  });
  it("parses a minimal draft and applies settings defaults", () => {
    const r = parseDraft(draft([page("page1", [field("story", "long_text")])]), registry);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.version.pages[0]?.fields[0]?.settings).toEqual({ rows: 4 });
  });
  it("rejects unknown types with the field path", () => {
    const r = parseDraft(draft([page("page1", [field("x_field", "slider")])]), registry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toBe("pages/0/fields/0/type");
  });
  it("rejects rules the type does not allow", () => {
    const r = parseDraft(
      draft([
        page("page1", [
          field("num1", "number", { validation: [{ rule: "min_length", value: 2 }] }),
        ]),
      ]),
      registry,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toBe("pages/0/fields/0/validation/0");
  });
  it("rejects duplicate keys across pages", () => {
    const r = parseDraft(
      draft([
        page("page1", [field("field_a", "short_text")]),
        page("page2", [field("field_a", "short_text")]),
      ]),
      registry,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.message).toMatch(/duplicate key/);
  });
  it("rejects more than 20 pages and more than 15 inputs on a page", () => {
    const many = Array.from({ length: 21 }, (_, i) => page(`page${String(i)}`, []));
    expect(parseDraft(draft(many), registry).ok).toBe(false);
    const dense = page(
      "page1",
      Array.from({ length: 16 }, (_, i) => field(`field${String(i)}`, "short_text")),
    );
    expect(parseDraft(draft([dense]), registry).ok).toBe(false);
    const denseWithSections = page("page1", [
      ...Array.from({ length: 15 }, (_, i) => field(`field${String(i)}`, "short_text")),
      field("sect", "section", { settings: { title: { en: "x" } } }),
    ]);
    expect(parseDraft(draft([denseWithSections]), registry).ok).toBe(true);
  });
  it("rejects a condition value of the wrong type for an existing field, with a path", () => {
    const r = parseDraft(
      draft([
        page("page1", [
          field("weeks", "number"),
          field("note", "short_text", {
            visibility: { field: "weeks", op: "greater_than", value: "thirty" },
          }),
        ]),
      ]),
      registry,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toBe("pages/0/fields/1/visibility/value");
  });
  it("rejects an operator the referenced type does not allow", () => {
    const r = parseDraft(
      draft([
        page("page1", [
          field("agree", "checkbox"),
          field("note", "short_text", {
            visibility: { field: "agree", op: "contains", value: "x" },
          }),
        ]),
      ]),
      registry,
    );
    expect(r.ok).toBe(false);
  });
  it("accepts a forward or missing reference at draft time", () => {
    const r = parseDraft(
      draft([
        page("page1", [
          field("note", "short_text", { visibility: { field: "later", op: "is_empty" } }),
          field("later", "short_text"),
        ]),
      ]),
      registry,
    );
    expect(r.ok).toBe(true);
  });
  it("accepts is_one_of with an array of the field's answer shape", () => {
    const opts = {
      options: [
        { key: "opt_one", label: { en: "1" } },
        { key: "opt_two", label: { en: "2" } },
      ],
    };
    const ok = parseDraft(
      draft([
        page("page1", [
          field("choice", "single_choice", { settings: opts }),
          field("note", "short_text", {
            visibility: { field: "choice", op: "is_one_of", value: ["opt_one", "opt_two"] },
          }),
        ]),
      ]),
      registry,
    );
    expect(ok.ok).toBe(true);
    const bad = parseDraft(
      draft([
        page("page1", [
          field("choice", "single_choice", { settings: opts }),
          field("note", "short_text", {
            visibility: { field: "choice", op: "is_one_of", value: "opt_one" },
          }),
        ]),
      ]),
      registry,
    );
    expect(bad.ok).toBe(false);
  });
  it("checks contains values against the element shape of a multiple_choice answer", () => {
    const opts = {
      options: [
        { key: "opt_one", label: { en: "1" } },
        { key: "opt_two", label: { en: "2" } },
      ],
    };
    const withValue = (value: unknown) =>
      parseDraft(
        draft([
          page("page1", [
            field("multi", "multiple_choice", { settings: opts }),
            field("note", "short_text", {
              visibility: { field: "multi", op: "contains", value },
            }),
          ]),
        ]),
        registry,
      );
    expect(withValue("opt_one").ok).toBe(true);
    const bad = withValue(["opt_one"]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues[0]?.path).toMatch(/visibility\/value$/);
  });
  it("checks contains values against the answer shape of a text field", () => {
    const withValue = (value: unknown) =>
      parseDraft(
        draft([
          page("page1", [
            field("note", "short_text"),
            field("other", "short_text", {
              visibility: { field: "note", op: "contains", value },
            }),
          ]),
        ]),
        registry,
      );
    expect(withValue("x").ok).toBe(true);
    expect(withValue(5).ok).toBe(false);
  });
});

describe("conditionOwners", () => {
  it("lists every condition in document order, page before its fields, with its order limit", () => {
    const shown = { field: "aaaa", op: "is_not_empty" };
    const r = parseDraft(
      draft([
        page("page1", [
          field("aaaa", "short_text"),
          field("bbbb", "short_text", { visibility: shown }),
        ]),
        {
          ...page("page2", [field("cccc", "short_text", { visibility: shown })]),
          visibility: shown,
        },
      ]),
      registry,
    );
    if (!r.ok) throw new Error(JSON.stringify(r.issues));

    expect(conditionOwners(r.version)).toEqual([
      { key: "bbbb", condition: shown, limit: 1, path: "pages/0/fields/1/visibility" },
      { key: "page2", condition: shown, limit: 2, path: "pages/1/visibility" },
      { key: "cccc", condition: shown, limit: 2, path: "pages/1/fields/0/visibility" },
    ]);
  });
});
