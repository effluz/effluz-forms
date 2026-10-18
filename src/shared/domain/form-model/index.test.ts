import { describe, expect, it } from "vitest";
import {
  createRegistry,
  defineFieldType,
  DROPDOWN_MIN_OPTIONS,
  fieldTypeIds,
  fieldTypes,
  graphemeLength,
  optionSchema,
  type ExclusiveRole,
  type Option,
  type PublishIssueDraft,
  type RuleContext,
  type SettingsText,
  type ValidationOutcome,
} from "./index";

describe("form-model public API", () => {
  it("exposes every field type definition by id", () => {
    expect(Object.keys(fieldTypes).sort()).toEqual([...fieldTypeIds].sort());
    for (const [id, def] of Object.entries(fieldTypes)) expect(def.id).toBe(id);
  });
  it("builds a registry from the exposed definitions", () => {
    const registry = createRegistry([fieldTypes.short_text, fieldTypes.consent]);
    expect(registry.list().map((d) => d.id)).toEqual(["short_text", "consent"]);
    expect(defineFieldType(fieldTypes.checkbox)).toBe(fieldTypes.checkbox);
  });
  it("exposes the option schema, dropdown threshold and grapheme counter", () => {
    const option: Option = optionSchema.parse({ key: "opt_one", label: { en: "One" } });
    expect(option.key).toBe("opt_one");
    expect(DROPDOWN_MIN_OPTIONS).toBe(7);
    expect(graphemeLength(" María ")).toBe(5);
    const ctx: RuleContext = { today: "2026-10-10" };
    const outcome: ValidationOutcome = { code: "max_length", params: { n: 5 } };
    expect([ctx.today, outcome]).toHaveLength(2);
  });
  it("exposes the field type hook types and the hooks on the definitions", () => {
    const text: SettingsText = { path: "title", text: { en: "Info" }, blankCode: "unlabeled" };
    const draft: PublishIssueDraft = { code: "consent_checklist", path: "settings/coveredItems" };
    const role: ExclusiveRole = { role: "submitter_address", code: "submitter_email_dup" };
    expect(fieldTypes.section.localizedSettingsTexts?.({ title: { en: "Info" } })[0]).toEqual(text);
    expect(
      fieldTypes.consent.publishChecks?.(
        { required: false, validation: [] },
        { text: { en: "x" }, coveredItems: [] },
        { postPlan: false },
      ),
    ).toEqual([draft]);
    expect(fieldTypes.email.exclusiveRoles?.({ isSubmitterAddress: true })).toEqual([role]);
  });
});
