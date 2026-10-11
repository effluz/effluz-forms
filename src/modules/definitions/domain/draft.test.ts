import { describe, expect, it } from "vitest";
import {
  buildDefaultRegistry,
  keySchema,
  parseDraft,
  referencedKeys,
  type Condition,
  type Version,
} from "@/shared/domain/form-model";
import {
  DRAFT_AUDIT_WINDOW_MS,
  duplicateDocument,
  emptyDocument,
  newKey,
  shouldAuditSave,
  type Draft,
  type IdSource,
} from "./draft";

function sequentialIds(): IdSource {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      const hex = n.toString(16).padStart(8, "0");
      return `${hex}-0000-4000-8000-000000000000`;
    },
  };
}

const title = { en: "Camp", es: "Campamento" };

describe("newKey", () => {
  it("builds a valid key from the prefix and the first 8 hex characters", () => {
    const key = newKey({ newId: () => "AB12CD34-ef56-4000-8000-000000000000" }, "f");
    expect(key).toBe("f_ab12cd34");
    expect(keySchema.safeParse(key).success).toBe(true);
  });

  it("starts with the requested prefix", () => {
    const ids = sequentialIds();
    expect(newKey(ids, "p").startsWith("p_")).toBe(true);
    expect(newKey(ids, "o").startsWith("o_")).toBe(true);
  });

  it("surfaces a malformed id immediately", () => {
    expect(() => newKey({ newId: () => "!!!!!!!!-0000-4000-8000-000000000000" }, "f")).toThrow();
  });
});

describe("emptyDocument", () => {
  it("has one empty page, the title and the languages", () => {
    const doc = emptyDocument(title, "bilingual", sequentialIds());
    expect(doc.title).toEqual(title);
    expect(doc.languages).toBe("bilingual");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]?.fields).toEqual([]);
    expect(doc.confirmation).toEqual({ screen: {} });
    expect(parseDraft(doc, buildDefaultRegistry()).ok).toBe(true);
  });
});

const sourceInput = {
  title: { en: "Source", es: "Origen" },
  languages: "bilingual",
  headerImage: { ref: "11111111-1111-4111-8111-111111111111", alt: { en: "Tent", es: "Carpa" } },
  pages: [
    {
      key: "page_one",
      title: { en: "One", es: "Uno" },
      fields: [
        {
          key: "colour",
          type: "single_choice",
          label: { en: "Colour", es: "Color" },
          settings: {
            options: [
              { key: "opt_red", label: { en: "Red", es: "Rojo" } },
              { key: "opt_blue", label: { en: "Blue", es: "Azul" } },
            ],
          },
        },
      ],
    },
    {
      key: "page_two",
      title: { en: "Two", es: "Dos" },
      visibility: { field: "colour", op: "equals", value: "opt_red" },
      fields: [
        {
          key: "reason",
          type: "short_text",
          label: { en: "Why", es: "Por que" },
          visibility: {
            all: [{ field: "colour", op: "is_one_of", value: ["opt_red", "opt_blue"] }],
          },
        },
      ],
    },
  ],
  confirmation: { screen: { en: "Thanks", es: "Gracias" } },
};

function parsed(input: unknown): Version {
  const r = parseDraft(input, buildDefaultRegistry());
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.version;
}

function optionKeys(doc: Version): string[] {
  const settings = doc.pages[0]?.fields[0]?.settings as { options: { key: string }[] };
  return settings.options.map((o) => o.key);
}

describe("duplicateDocument", () => {
  const source = parsed(sourceInput);
  const copy = duplicateDocument(source, { en: "Copy", es: "Copia" }, sequentialIds());

  it("replaces the title and drops the header image", () => {
    expect(copy.title).toEqual({ en: "Copy", es: "Copia" });
    expect(copy.headerImage).toBeUndefined();
  });

  it("gives every page, field and option a new key", () => {
    const oldKeys = new Set(["page_one", "page_two", "colour", "reason", "opt_red", "opt_blue"]);
    const newKeys = [
      ...copy.pages.map((p) => p.key),
      ...copy.pages.flatMap((p) => p.fields.map((f) => f.key)),
      ...optionKeys(copy),
    ];
    expect(newKeys).toHaveLength(6);
    expect(new Set(newKeys).size).toBe(6);
    for (const key of newKeys) expect(oldKeys.has(key)).toBe(false);
  });

  it("remaps conditions to the new field key and the new option keys", () => {
    const colour = copy.pages[0]?.fields[0];
    const [red, blue] = optionKeys(copy);
    const pageCondition = copy.pages[1]?.visibility as Condition;
    expect(referencedKeys(pageCondition)).toEqual([colour?.key]);
    expect(pageCondition).toMatchObject({ value: red });

    const fieldCondition = copy.pages[1]?.fields[0]?.visibility as Condition;
    expect(referencedKeys(fieldCondition)).toEqual([colour?.key]);
    expect(fieldCondition).toEqual({
      all: [{ field: colour?.key, op: "is_one_of", value: [red, blue] }],
    });
  });

  it("produces a document that parses", () => {
    expect(parseDraft(copy, buildDefaultRegistry()).ok).toBe(true);
  });

  it("leaves the source untouched", () => {
    expect(source.pages[0]?.key).toBe("page_one");
    expect(source.headerImage).toBeDefined();
  });
});

describe("shouldAuditSave", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const draft = (overrides: Partial<Draft> = {}): Draft => ({
    formId: "form-1",
    revision: 3,
    document: emptyDocument(title, "bilingual", sequentialIds()),
    updatedBy: "staff@example.com",
    updatedAt: now,
    auditedBy: "staff@example.com",
    auditedAt: new Date(now.getTime() - 60_000),
    ...overrides,
  });

  it("audits a different actor", () => {
    expect(shouldAuditSave(draft(), "other@example.com", now)).toBe(true);
  });

  it("audits the first save", () => {
    expect(
      shouldAuditSave(draft({ auditedBy: null, auditedAt: null }), "staff@example.com", now),
    ).toBe(true);
  });

  it("audits once the window has passed", () => {
    const old = new Date(now.getTime() - DRAFT_AUDIT_WINDOW_MS - 1);
    expect(shouldAuditSave(draft({ auditedAt: old }), "staff@example.com", now)).toBe(true);
  });

  it("audits at exactly the window length", () => {
    const edge = new Date(now.getTime() - DRAFT_AUDIT_WINDOW_MS);
    expect(shouldAuditSave(draft({ auditedAt: edge }), "staff@example.com", now)).toBe(true);
  });

  it("skips the same actor inside the window", () => {
    expect(shouldAuditSave(draft(), "staff@example.com", now)).toBe(false);
  });
});
