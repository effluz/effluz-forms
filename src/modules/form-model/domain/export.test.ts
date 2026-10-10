import { describe, expect, it } from "vitest";
import { exportColumns, exportRow } from "./export";
import { buildDefaultRegistry } from "./field-types";
import { parseDraft } from "./version";

const registry = buildDefaultRegistry();
const parse = (input: unknown) => {
  const r = parseDraft(input, registry);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.version;
};
const v1 = parse({
  languages: "bilingual",
  confirmation: { screen: { en: "x", es: "x" } },
  pages: [
    {
      key: "page1",
      title: { en: "p", es: "p" },
      fields: [
        { key: "name", type: "short_text", label: { en: "Name", es: "Nombre" } },
        { key: "old_num", type: "number", label: { en: "Old field", es: "Campo viejo" } },
        {
          key: "pics",
          type: "file_upload",
          label: { en: "Photos", es: "Fotos" },
          settings: { kinds: ["image"] },
        },
      ],
    },
  ],
});
const v2 = parse({
  languages: "bilingual",
  confirmation: { screen: { en: "x", es: "x" } },
  pages: [
    {
      key: "page1",
      title: { en: "p", es: "p" },
      fields: [
        { key: "info", type: "section", label: {}, settings: { title: { en: "i", es: "i" } } },
        {
          key: "pics",
          type: "file_upload",
          label: { en: "Pictures", es: "Imágenes" },
          settings: { kinds: ["image"] },
        },
        { key: "name", type: "short_text", label: { en: "Full name", es: "Nombre completo" } },
        { key: "new_box", type: "checkbox", label: { en: "New", es: "Nuevo" } },
      ],
    },
  ],
});

describe("exportColumns", () => {
  it("orders by the latest version, appends older-only keys, labels from the latest, expands multi-cell types", () => {
    const cols = exportColumns([v1, v2], registry, "es");
    expect(cols.map((c) => c.header)).toEqual([
      "Imágenes (count)",
      "Imágenes (files)",
      "Nombre completo",
      "Nuevo",
      "Campo viejo",
    ]);
    expect(cols.map((c) => c.key)).toEqual(["pics", "pics", "name", "new_box", "old_num"]);
  });
});

describe("exportRow", () => {
  const cols = exportColumns([v1, v2], registry, "en");
  it("fills from the submission's own version and blanks keys it lacks", () => {
    expect(
      exportRow(cols, v1, registry, { name: "Ana", old_num: 3, pics: ["m_aaaaaaaa"] }, "en"),
    ).toEqual(["1", "m_aaaaaaaa", "Ana", "", "3"]);
    expect(exportRow(cols, v2, registry, { name: "Ana", new_box: true, pics: [] }, "en")).toEqual([
      "0",
      "",
      "Ana",
      "yes",
      "",
    ]);
  });
});
