import { describe, expect, it } from "vitest";
import { buildDefaultRegistry, parseDraft, type Version } from "@/shared/domain/form-model";
import { countFields, diffVersions, sameDefinition } from "./diff";

const registry = buildDefaultRegistry();
const parse = (input: unknown): Version => {
  const r = parseDraft(input, registry);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.version;
};

const name = { key: "name", type: "short_text", label: { en: "Name", es: "Nombre" } };
const colour = {
  key: "colour",
  type: "single_choice",
  label: { en: "Colour", es: "Color" },
  settings: {
    options: [
      { key: "opt_red", label: { en: "Red", es: "Rojo" } },
      { key: "opt_blue", label: { en: "Blue", es: "Azul" } },
    ],
  },
};
const intro = {
  key: "intro",
  type: "section",
  label: { en: "Intro", es: "Introduccion" },
  settings: { title: { en: "Intro", es: "Introduccion" } },
};
const note = { key: "note", type: "short_text", label: { en: "Note", es: "Nota" } };

const doc = (
  page1Fields: unknown[],
  page2: Record<string, unknown> = {},
  page2Fields: unknown[] = [colour],
) => ({
  languages: "bilingual",
  confirmation: { screen: { en: "Thanks", es: "Gracias" } },
  pages: [
    { key: "page1", title: { en: "One", es: "Uno" }, fields: page1Fields },
    { key: "page2", title: { en: "Two", es: "Dos" }, fields: page2Fields, ...page2 },
  ],
});

const base = () => doc([intro, name]);

describe("diffVersions", () => {
  it("returns empty arrays for identical documents", () => {
    expect(diffVersions(parse(base()), parse(base()))).toEqual({
      addedKeys: [],
      removedKeys: [],
      changedLabels: [],
      changedLogic: [],
    });
  });

  it("lists added and removed field keys", () => {
    const next = parse(doc([intro, name, note]));
    expect(diffVersions(parse(base()), next).addedKeys).toEqual(["note"]);
    expect(diffVersions(next, parse(base())).removedKeys).toEqual(["note"]);
  });

  it("lists a relabeled field", () => {
    const next = parse(
      doc([intro, { ...name, label: { en: "Full name", es: "Nombre completo" } }]),
    );
    const d = diffVersions(parse(base()), next);
    expect(d.changedLabels).toEqual(["name"]);
    expect(d.changedLogic).toEqual([]);
  });

  it("lists a field whose visibility changed", () => {
    const cond = { field: "colour", op: "equals", value: "opt_red" };
    const before = parse(doc([intro, name], {}, [colour, { ...note, visibility: cond }]));
    const after = parse(
      doc([intro, name], {}, [colour, { ...note, visibility: { ...cond, value: "opt_blue" } }]),
    );
    expect(diffVersions(before, after).changedLogic).toEqual(["note"]);
    const unconditioned = parse(doc([intro, name], {}, [colour, note]));
    expect(diffVersions(unconditioned, before).changedLogic).toEqual(["note"]);
  });

  it("lists the page key when a page condition changed", () => {
    const cond = { field: "colour", op: "equals", value: "opt_red" };
    const before = parse(doc([intro, name, colour], {}, [note]));
    const after = parse(doc([intro, name, colour], { visibility: cond }, [note]));
    expect(diffVersions(before, after).changedLogic).toEqual(["page2"]);
  });
});

describe("sameDefinition", () => {
  it("ignores property order", () => {
    const a = parse(base());
    const reordered = parse({
      pages: base().pages.map((p) => ({ fields: p.fields, title: p.title, key: p.key })),
      confirmation: { screen: { es: "Gracias", en: "Thanks" } },
      languages: "bilingual",
    });
    expect(sameDefinition(a, reordered)).toBe(true);
  });

  it("detects a label change", () => {
    const changed = parse(doc([intro, { ...name, label: { en: "Name!", es: "Nombre" } }]));
    expect(sameDefinition(parse(base()), changed)).toBe(false);
  });
});

describe("countFields", () => {
  it("counts pages and input fields only, ignoring sections", () => {
    expect(countFields(parse(base()), registry)).toEqual({ pages: 2, fields: 2 });
  });
});
