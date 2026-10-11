import { describe, expect, it } from "vitest";
import { buildDefaultRegistry } from "./field-types";
import { validatePage } from "./submission";
import { parseDraft, type Version } from "./version";
import { visiblePages } from "./visibility";

const registry = buildDefaultRegistry();
const ctx = { today: "2026-10-10" };
const choice = (key: string, en: string) => ({ key, label: { en } });

function version(): Version {
  const parsed = parseDraft(
    {
      languages: "en",
      title: { en: "T" },
      confirmation: { screen: { en: "Thanks" } },
      pages: [
        {
          key: "page_one",
          fields: [
            {
              key: "has_baby",
              type: "single_choice",
              label: { en: "Baby?" },
              required: true,
              settings: { options: [choice("yes_opt", "Yes"), choice("no_opt", "No")] },
            },
            { key: "contact", type: "email", label: { en: "Email" } },
          ],
        },
        {
          key: "page_two",
          visibility: { field: "has_baby", op: "equals", value: "yes_opt" },
          fields: [{ key: "baby_name", type: "short_text", label: { en: "Name" }, required: true }],
        },
      ],
    },
    registry,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.version;
}

const enforce = { enforceRequired: true };

describe("validatePage", () => {
  it("validates only the asked page and returns its normalized answers", () => {
    const r = validatePage(
      version(),
      registry,
      { has_baby: "yes_opt", contact: " A@Example.com " },
      "page_one",
      ctx,
      enforce,
    );
    expect(r).toEqual({ answers: { has_baby: "yes_opt", contact: "a@example.com" }, issues: [] });
  });

  it("reports required and invalid answers on the page", () => {
    const r = validatePage(version(), registry, { contact: "nope" }, "page_one", ctx, enforce);
    expect(r.issues.map((i) => [i.field, i.code])).toEqual([
      ["has_baby", "required"],
      ["contact", "email_syntax"],
    ]);
  });

  it("skips absent answers without enforcing required, and still drops invalid ones", () => {
    const r = validatePage(version(), registry, { contact: "nope" }, "page_one", ctx, {
      enforceRequired: false,
    });
    expect(r).toEqual({ answers: {}, issues: [{ code: "email_syntax", field: "contact" }] });
  });

  it("uses earlier answers for the asked page's conditions", () => {
    const shown = validatePage(
      version(),
      registry,
      { has_baby: "yes_opt" },
      "page_two",
      ctx,
      enforce,
    );
    expect(shown.issues).toEqual([{ code: "required", field: "baby_name" }]);
    const hidden = validatePage(
      version(),
      registry,
      { has_baby: "no_opt", baby_name: "x" },
      "page_two",
      ctx,
      enforce,
    );
    expect(hidden).toEqual({ answers: {}, issues: [] });
  });

  it("returns nothing for an unknown page", () => {
    expect(validatePage(version(), registry, {}, "page_nine", ctx, enforce)).toEqual({
      answers: {},
      issues: [],
    });
  });
});

describe("visiblePages", () => {
  it("follows the page conditions", () => {
    expect(visiblePages(version(), { has_baby: "yes_opt" }, registry).map((p) => p.key)).toEqual([
      "page_one",
      "page_two",
    ]);
    expect(visiblePages(version(), { has_baby: "no_opt" }, registry).map((p) => p.key)).toEqual([
      "page_one",
    ]);
  });
});

describe("uploadLimits", () => {
  it("is defined by file_upload alone and reads its settings", () => {
    const withHook = registry
      .list()
      .filter((d) => d.uploadLimits !== undefined)
      .map((d) => d.id);
    expect(withHook).toEqual(["file_upload"]);
    expect(
      registry
        .get("file_upload")
        .uploadLimits?.({ kinds: ["image", "video"], maxFiles: 3, maxSizeMb: 5 }),
    ).toEqual({
      kinds: ["image", "video"],
      maxFiles: 3,
      maxSizeMb: 5,
    });
  });
});
