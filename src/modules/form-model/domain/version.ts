import { z } from "zod";
import { languagesSchema, localizedTextSchema } from "@/shared/domain/localized-text";
import { conditionSchema, type Condition } from "./condition";
import { fieldTypeIds } from "./field-type";
import { mediaIdSchema } from "./field-types/file-upload";
import { keySchema } from "./keys";
import { LIMITS } from "./limits";
import { OPERATORS } from "./operators";
import type { FieldTypeRegistry } from "./registry";
import { ruleSchema } from "./rules";

export const fieldSchema = z.object({
  key: keySchema,
  type: z.enum(fieldTypeIds),
  label: localizedTextSchema.default({}),
  help: localizedTextSchema.optional(),
  required: z.boolean().default(false),
  personal: z.boolean().default(false),
  validation: z.array(ruleSchema).default([]),
  settings: z.unknown().default({}),
  visibility: conditionSchema.optional(),
});
export type Field = z.infer<typeof fieldSchema>;

export const pageSchema = z.object({
  key: keySchema,
  title: localizedTextSchema.default({}),
  description: localizedTextSchema.optional(),
  fields: z.array(fieldSchema).default([]),
  visibility: conditionSchema.optional(),
});
export type Page = z.infer<typeof pageSchema>;

export const versionSchema = z.object({
  languages: languagesSchema,
  headerImage: z.object({ ref: mediaIdSchema, alt: localizedTextSchema.default({}) }).optional(),
  pages: z.array(pageSchema).min(1).max(LIMITS.pagesPerForm),
  confirmation: z.object({
    screen: localizedTextSchema.default({}),
    email: z.object({ subject: localizedTextSchema, body: localizedTextSchema }).optional(),
  }),
});
export type Version = z.infer<typeof versionSchema>;

export interface ParseIssue {
  path: string;
  message: string;
}
export type ParseResult = { ok: true; version: Version } | { ok: false; issues: ParseIssue[] };

type Segment = string | number | symbol;
const pathOf = (segments: readonly Segment[]) => segments.map((s) => String(s)).join("/");

export function inputFields(version: Version, registry?: FieldTypeRegistry): Field[] {
  return version.pages.flatMap((p) =>
    p.fields.filter((f) => (registry ? registry.get(f.type).isInput : f.type !== "section")),
  );
}

export function fieldIndex(
  version: Version,
): Map<string, { field: Field; page: Page; order: number }> {
  const map = new Map<string, { field: Field; page: Page; order: number }>();
  let order = 0;
  for (const page of version.pages)
    for (const field of page.fields) map.set(field.key, { field, page, order: order++ });
  return map;
}

function clauseIssues(
  cond: Condition,
  index: ReturnType<typeof fieldIndex>,
  registry: FieldTypeRegistry,
  base: (string | number)[],
): ParseIssue[] {
  if ("all" in cond)
    return cond.all.flatMap((c, i) => clauseIssues(c, index, registry, [...base, "all", i]));
  if ("any" in cond)
    return cond.any.flatMap((c, i) => clauseIssues(c, index, registry, [...base, "any", i]));
  const target = index.get(cond.field);
  if (!target) return []; // missing or later references are publish issues
  const def = registry.get(target.field.type);
  const issues: ParseIssue[] = [];
  if (!def.allowedOperators.includes(cond.op))
    issues.push({
      path: pathOf([...base, "op"]),
      message: `operator ${cond.op} not allowed for ${def.id}`,
    });
  if (OPERATORS[cond.op].needsValue) {
    const valueSchema = cond.op === "is_one_of" ? z.array(def.answerSchema) : def.answerSchema;
    if (!valueSchema.safeParse(cond.value).success)
      issues.push({
        path: pathOf([...base, "value"]),
        message: `value does not match the ${def.id} answer shape`,
      });
  }
  return issues;
}

export function parseDraft(input: unknown, registry: FieldTypeRegistry): ParseResult {
  const structural = versionSchema.safeParse(input);
  if (!structural.success) {
    return {
      ok: false,
      issues: structural.error.issues.map((i) => ({
        path: pathOf(i.path),
        message: i.message,
      })),
    };
  }
  const version = structural.data;
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();

  version.pages.forEach((page, pi) => {
    if (seen.has(page.key))
      issues.push({ path: pathOf(["pages", pi, "key"]), message: `duplicate key ${page.key}` });
    seen.add(page.key);
    let inputs = 0;
    page.fields.forEach((field, fi) => {
      const base = ["pages", pi, "fields", fi];
      if (seen.has(field.key))
        issues.push({ path: pathOf([...base, "key"]), message: `duplicate key ${field.key}` });
      seen.add(field.key);
      if (!registry.has(field.type)) {
        issues.push({
          path: pathOf([...base, "type"]),
          message: `unknown field type ${String(field.type)}`,
        });
        return;
      }
      const def = registry.get(field.type);
      if (def.isInput) inputs++;
      const settings = def.settingsSchema.safeParse(field.settings);
      if (!settings.success)
        settings.error.issues.forEach((i) =>
          issues.push({
            path: pathOf([...base, "settings", ...i.path]),
            message: i.message,
          }),
        );
      else field.settings = settings.data;
      field.validation.forEach((rule, ri) => {
        if (!def.allowedRules.includes(rule.rule))
          issues.push({
            path: pathOf([...base, "validation", ri]),
            message: `rule ${rule.rule} not allowed for ${def.id}`,
          });
      });
    });
    if (inputs > LIMITS.inputFieldsPerPage)
      issues.push({
        path: pathOf(["pages", pi, "fields"]),
        message: `more than ${String(LIMITS.inputFieldsPerPage)} input fields`,
      });
  });

  if (issues.length === 0) {
    const index = fieldIndex(version);
    version.pages.forEach((page, pi) => {
      if (page.visibility)
        issues.push(...clauseIssues(page.visibility, index, registry, ["pages", pi, "visibility"]));
      page.fields.forEach((field, fi) => {
        if (field.visibility)
          issues.push(
            ...clauseIssues(field.visibility, index, registry, [
              "pages",
              pi,
              "fields",
              fi,
              "visibility",
            ]),
          );
      });
    });
  }

  return issues.length ? { ok: false, issues } : { ok: true, version };
}
