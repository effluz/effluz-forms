import { describe, expect, it } from "vitest";
import { consentItems } from "./field-types/consent";
import { buildDefaultRegistry } from "./field-types";
import { checkDefinition, collectsPersonalData, parseVersion, validateForPublish } from "./publish";
import { parseDraft } from "./version";

const registry = buildDefaultRegistry();
const parse = (input: unknown) => {
  const r = parseDraft(input, registry);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.version;
};
const consentField = {
  key: "agree",
  type: "consent",
  label: { en: "Consent", es: "Consentimiento" },
  settings: { text: { en: "I agree", es: "Acepto" }, coveredItems: [...consentItems] },
};
const nameField = { key: "name", type: "short_text", label: { en: "Name", es: "Nombre" } };
const mailField = {
  key: "mail",
  type: "email",
  label: { en: "Email", es: "Correo" },
  settings: { isSubmitterAddress: true },
};
const page1 = { key: "page1", title: { en: "One", es: "Uno" } };
const base = {
  languages: "bilingual",
  confirmation: { screen: { en: "Thanks", es: "Gracias" } },
  pages: [{ ...page1, fields: [nameField, mailField, consentField] }],
};
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);
const withFields = (fields: unknown[]) => ({
  ...base,
  pages: [{ ...page1, fields }],
});

describe("collectsPersonalData", () => {
  it("is true with an email, phone, file upload or personal-flagged field", () => {
    expect(collectsPersonalData(parse(base), registry)).toBe(true);
    const plain = parse({
      ...base,
      pages: [
        {
          key: "page1",
          title: { en: "x", es: "x" },
          fields: [{ key: "num1", type: "number", label: { en: "N", es: "N" } }],
        },
      ],
    });
    expect(collectsPersonalData(plain, registry)).toBe(false);
    const flagged = parse({
      ...base,
      pages: [
        {
          key: "page1",
          title: { en: "x", es: "x" },
          fields: [{ key: "num1", type: "number", label: { en: "N", es: "N" }, personal: true }],
        },
      ],
    });
    expect(collectsPersonalData(flagged, registry)).toBe(true);
  });
});

describe("checkDefinition", () => {
  it("passes a complete bilingual definition", () => {
    expect(checkDefinition(parse(base), registry)).toEqual([]);
  });
  it("reports no_input, unlabeled, missing_translation and confirmation_missing", () => {
    const v = parse({
      languages: "bilingual",
      confirmation: { screen: {} },
      pages: [
        {
          key: "page1",
          title: { en: "One" },
          fields: [{ key: "sect", type: "section", label: {}, settings: { title: {} } }],
        },
      ],
    });
    expect(codes(checkDefinition(v, registry))).toEqual(
      expect.arrayContaining([
        "no_input",
        "unlabeled",
        "missing_translation",
        "confirmation_missing",
      ]),
    );
  });
  it("reports missing_translation with the language and path", () => {
    const v = parse({
      ...base,
      pages: [
        {
          key: "page1",
          title: { en: "One", es: "Uno" },
          fields: [{ key: "name", type: "short_text", label: { en: "Name" } }],
        },
      ],
    });
    expect(checkDefinition(v, registry)).toContainEqual({
      code: "missing_translation",
      path: "pages/0/fields/0/label",
      params: { lang: "es" },
    });
  });
  it("reports option_unlabeled for an option blank in every required language", () => {
    const v = parse(
      withFields([
        {
          key: "pick",
          type: "single_choice",
          label: { en: "Pick", es: "Elige" },
          settings: {
            options: [
              { key: "opt_one", label: { en: "One", es: "Uno" } },
              { key: "opt_two", label: {} },
            ],
          },
        },
        consentField,
      ]),
    );
    expect(checkDefinition(v, registry)).toContainEqual({
      code: "option_unlabeled",
      path: "pages/0/fields/0/settings/options/1/label",
    });
  });
  it("reports consent_missing when personal data is collected without consent", () => {
    const v = parse({
      ...base,
      pages: [{ key: "page1", title: { en: "One", es: "Uno" }, fields: [mailField] }],
    });
    expect(codes(checkDefinition(v, registry))).toContain("consent_missing");
  });
  it("reports consent_missing at a consent field that has a visibility condition", () => {
    const v = parse(
      withFields([
        nameField,
        mailField,
        { ...consentField, visibility: { field: "name", op: "is_not_empty" } },
      ]),
    );
    expect(checkDefinition(v, registry)).toContainEqual({
      code: "consent_missing",
      path: "pages/0/fields/2",
    });
  });
  it("reports consent_missing at a consent field on a page that has a visibility condition", () => {
    const v = parse({
      ...base,
      pages: [
        { ...page1, fields: [nameField, mailField] },
        {
          key: "page2",
          title: { en: "Two", es: "Dos" },
          visibility: { field: "name", op: "is_not_empty" },
          fields: [consentField],
        },
      ],
    });
    expect(checkDefinition(v, registry)).toContainEqual({
      code: "consent_missing",
      path: "pages/1/fields/0",
    });
  });
  it("reports consent_checklist when an item is not covered", () => {
    const v = parse({
      ...base,
      pages: [
        {
          ...page1,
          fields: [
            nameField,
            {
              ...consentField,
              settings: {
                text: { en: "I agree", es: "Acepto" },
                coveredItems: consentItems.slice(1),
              },
            },
          ],
        },
      ],
    });
    expect(codes(checkDefinition(v, registry))).toContain("consent_checklist");
  });
  it("reports over_maximum for more than one consent field", () => {
    const v = parse(
      withFields([nameField, mailField, consentField, { ...consentField, key: "agree2" }]),
    );
    expect(checkDefinition(v, registry)).toContainEqual({
      code: "over_maximum",
      path: "pages",
      params: { detail: "more than one consent field" },
    });
    expect(
      checkDefinition(parse(base), registry).filter((i) => i.code === "over_maximum"),
    ).toHaveLength(0);
  });
  it("reports submitter_email_dup", () => {
    const second = {
      key: "mail2",
      type: "email",
      label: { en: "Other", es: "Otro" },
      settings: { isSubmitterAddress: true },
    };
    const v = parse({
      ...base,
      pages: [{ ...page1, fields: [nameField, mailField, consentField, second] }],
    });
    expect(codes(checkDefinition(v, registry))).toContain("submitter_email_dup");
  });
  it("reports dangling_condition for missing and forward references, including page conditions", () => {
    const v = parse({
      ...base,
      pages: [
        {
          key: "page1",
          title: { en: "One", es: "Uno" },
          fields: [
            {
              key: "field_a",
              type: "short_text",
              label: { en: "A", es: "A" },
              visibility: { field: "zzzz", op: "is_empty" },
            },
            {
              key: "field_b",
              type: "short_text",
              label: { en: "B", es: "B" },
              visibility: { field: "field_c", op: "is_empty" },
            },
            { key: "field_c", type: "short_text", label: { en: "C", es: "C" } },
            mailField,
            consentField,
          ],
        },
        {
          key: "page2",
          title: { en: "Two", es: "Dos" },
          visibility: { field: "field_d", op: "is_empty" },
          fields: [{ key: "field_d", type: "short_text", label: { en: "D", es: "D" } }],
        },
      ],
    });
    const dangling = checkDefinition(v, registry).filter((i) => i.code === "dangling_condition");
    expect(dangling.map((i) => i.params?.ref)).toEqual(["zzzz", "field_c", "field_d"]);
  });
  it("accepts a condition that references an earlier field", () => {
    const v = parse(
      withFields([
        { key: "field_a", type: "short_text", label: { en: "A", es: "A" } },
        {
          key: "field_b",
          type: "short_text",
          label: { en: "B", es: "B" },
          visibility: { field: "field_a", op: "is_empty" },
        },
        mailField,
        consentField,
      ]),
    );
    expect(checkDefinition(v, registry)).toEqual([]);
  });
  it("reports over_maximum for rule values beyond caps", () => {
    const v = parse({
      ...base,
      pages: [
        {
          ...page1,
          fields: [
            {
              key: "name",
              type: "short_text",
              label: { en: "Name", es: "Nombre" },
              validation: [{ rule: "max_length", value: 6000 }],
            },
            {
              key: "pics",
              type: "file_upload",
              label: { en: "Pics", es: "Fotos" },
              settings: { kinds: ["image"], maxFiles: 3 },
              validation: [{ rule: "min_files", value: 4 }],
            },
            mailField,
            consentField,
          ],
        },
      ],
    });
    expect(checkDefinition(v, registry).filter((i) => i.code === "over_maximum")).toHaveLength(2);
  });
  it("reports over_maximum for a selection count beyond the option count", () => {
    const v = parse(
      withFields([
        {
          key: "picks",
          type: "multiple_choice",
          label: { en: "Picks", es: "Elecciones" },
          settings: {
            options: [
              { key: "opt_one", label: { en: "One", es: "Uno" } },
              { key: "opt_two", label: { en: "Two", es: "Dos" } },
            ],
          },
          validation: [{ rule: "min_selected", value: 3 }],
        },
        consentField,
      ]),
    );
    expect(checkDefinition(v, registry).filter((i) => i.code === "over_maximum")).toHaveLength(1);
  });
  it("reports header_alt_missing", () => {
    const v = parse({ ...base, headerImage: { ref: "m_aaaaaaaa", alt: { en: "Babies" } } });
    expect(checkDefinition(v, registry)).toContainEqual({
      code: "header_alt_missing",
      path: "headerImage/alt",
      params: { lang: "es" },
    });
  });
});

describe("validateForPublish and parseVersion", () => {
  it("adds retention_missing when retention is unset or out of range", () => {
    expect(codes(validateForPublish(parse(base), registry, {}))).toEqual(["retention_missing"]);
    expect(validateForPublish(parse(base), registry, { retentionMonths: 37 })).toHaveLength(1);
    expect(validateForPublish(parse(base), registry, { retentionMonths: 12 })).toEqual([]);
  });
  it("parseVersion is strict", () => {
    expect(parseVersion(base, registry).ok).toBe(true);
    const r = parseVersion({ ...base, confirmation: { screen: {} } }, registry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.message).toMatch(/confirmation_missing/);
  });
  it("parseVersion returns a draft failure as is", () => {
    const r = parseVersion({ ...base, pages: [] }, registry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.every((i) => !/_missing|unlabeled/.test(i.message))).toBe(true);
  });
});
