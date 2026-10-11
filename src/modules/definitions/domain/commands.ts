import { z } from "zod";
import {
  conditionSchema,
  fieldIndex,
  fieldTypeIds,
  keySchema,
  LIMITS,
  mediaIdSchema,
  parseDraft,
  referencedKeys,
  ruleSchema,
  type Condition,
  type Field,
  type FieldTypeId,
  type FieldTypeRegistry,
  type Key,
  type Page,
  type ParseIssue,
  type Version,
} from "@/shared/domain/form-model";
import {
  languagesSchema,
  localeSchema,
  localizedTextSchema,
  type Locale,
  type LocalizedText,
} from "@/shared/domain/localized-text";
import { newKey, type IdSource } from "./draft";

const text = localizedTextSchema;
const optionalCondition = conditionSchema.nullable().optional();

/**
 * Every edit the builder can make to a draft, as plain data.
 * See specs/use-cases/create-and-edit-form.md, "Main flow: edit the draft".
 * Field settings stay `unknown` here: the field type registry validates them.
 */
export const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rename_form"), title: text }),
  z.object({
    kind: z.literal("set_languages"),
    languages: languagesSchema,
    /** The surviving locale when texts are dropped; a confirmation, not a translation. */
    keep: localeSchema.optional(),
  }),
  z.object({ kind: z.literal("add_page"), afterPageKey: keySchema.optional() }),
  z.object({
    kind: z.literal("update_page"),
    pageKey: keySchema,
    title: text.optional(),
    description: text.nullable().optional(),
    visibility: optionalCondition,
  }),
  z.object({ kind: z.literal("move_page"), pageKey: keySchema, toIndex: z.number().int() }),
  z.object({ kind: z.literal("delete_page"), pageKey: keySchema }),
  z.object({
    kind: z.literal("add_field"),
    pageKey: keySchema,
    type: z.enum(fieldTypeIds),
    afterFieldKey: keySchema.optional(),
  }),
  z.object({
    kind: z.literal("update_field"),
    fieldKey: keySchema,
    patch: z.object({
      label: text.optional(),
      help: text.nullable().optional(),
      required: z.boolean().optional(),
      personal: z.boolean().optional(),
      validation: z.array(ruleSchema).optional(),
      settings: z.unknown().optional(),
      visibility: optionalCondition,
    }),
  }),
  z.object({
    kind: z.literal("change_field_type"),
    fieldKey: keySchema,
    type: z.enum(fieldTypeIds),
  }),
  z.object({
    kind: z.literal("move_field"),
    fieldKey: keySchema,
    toPageKey: keySchema,
    toIndex: z.number().int(),
  }),
  z.object({ kind: z.literal("delete_field"), fieldKey: keySchema }),
  z.object({
    kind: z.literal("set_header_image"),
    image: z.object({ ref: mediaIdSchema, alt: text }).nullable(),
  }),
  z.object({
    kind: z.literal("update_confirmation"),
    screen: text.optional(),
    email: z.object({ subject: text, body: text }).nullable().optional(),
  }),
]);
export type DraftCommand = z.infer<typeof commandSchema>;

export type RejectionCode =
  | "unknown_page"
  | "unknown_field"
  | "last_page"
  | "limit_pages"
  | "limit_fields"
  | "referenced_by_conditions"
  | "condition_unknown_field"
  | "condition_forward_reference"
  | "incompatible_type"
  | "invalid_document"
  | "bad_index";

export interface CommandRejection {
  code: RejectionCode;
  params?: Record<string, string | number>;
  issues?: ParseIssue[];
}

export type CommandResult =
  { ok: true; document: Version; createdKey?: Key } | { ok: false; rejection: CommandRejection };

export interface CommandDeps {
  registry: FieldTypeRegistry;
  ids: IdSource;
}

/**
 * The only type changes allowed in place; each pair works in both directions.
 * See specs/use-cases/create-and-edit-form.md, "Alternate flows and errors".
 */
export const COMPATIBLE_TYPE_CHANGES: ReadonlyArray<readonly [FieldTypeId, FieldTypeId]> = [
  ["short_text", "long_text"],
];

type Rejected = Extract<CommandResult, { ok: false }>;

function reject(
  code: RejectionCode,
  params?: Record<string, string | number>,
  issues?: ParseIssue[],
): Rejected {
  return {
    ok: false,
    rejection: { code, ...(params ? { params } : {}), ...(issues ? { issues } : {}) },
  };
}

function finish(next: Version, registry: FieldTypeRegistry, createdKey?: Key): CommandResult {
  const parsed = parseDraft(next, registry);
  if (!parsed.ok) return reject("invalid_document", undefined, parsed.issues);
  return { ok: true, document: parsed.version, ...(createdKey ? { createdKey } : {}) };
}

function pageIndexOf(doc: Version, key: string): number {
  return doc.pages.findIndex((p) => p.key === key);
}

function locateField(doc: Version, key: string): { page: Page; fi: number } | undefined {
  for (const page of doc.pages) {
    const fi = page.fields.findIndex((f) => f.key === key);
    if (fi >= 0) return { page, fi };
  }
  return undefined;
}

const isInput = (registry: FieldTypeRegistry, type: string): boolean =>
  registry.has(type) && registry.get(type).isInput;

const inputCount = (registry: FieldTypeRegistry, page: Page): number =>
  page.fields.filter((f) => isInput(registry, f.type)).length;

/** A visibility condition and the field order its references must stay below. */
interface ConditionOwner {
  key: string;
  condition: Condition;
  limit: number;
}

/**
 * Every condition in document order, page before its fields. A field may
 * reference only earlier fields; a page only fields on earlier pages, as in
 * `checkDefinition` (specs/form-definition.md).
 */
function conditionOwners(doc: Version): ConditionOwner[] {
  const owners: ConditionOwner[] = [];
  let order = 0;
  for (const page of doc.pages) {
    if (page.visibility) owners.push({ key: page.key, condition: page.visibility, limit: order });
    for (const field of page.fields) {
      if (field.visibility)
        owners.push({ key: field.key, condition: field.visibility, limit: order });
      order++;
    }
  }
  return owners;
}

/** Checks the condition owned by `key` in `doc`, if it has one. */
function checkOwnCondition(doc: Version, key: string): Rejected | undefined {
  const owner = conditionOwners(doc).find((o) => o.key === key);
  if (!owner) return undefined;
  const index = fieldIndex(doc);
  for (const ref of referencedKeys(owner.condition)) {
    const target = index.get(ref);
    if (!target) return reject("condition_unknown_field", { key, ref });
    if (target.order >= owner.limit) return reject("condition_forward_reference", { key, ref });
  }
  return undefined;
}

function forwardReferences(doc: Version): { key: string; ref: string }[] {
  const index = fieldIndex(doc);
  return conditionOwners(doc).flatMap((owner) =>
    referencedKeys(owner.condition)
      .filter((ref) => {
        const target = index.get(ref);
        return target !== undefined && target.order >= owner.limit;
      })
      .map((ref) => ({ key: owner.key, ref })),
  );
}

/** Refuses a reorder that makes a condition point forward; earlier problems are left alone. */
function checkReorder(before: Version, after: Version): Rejected | undefined {
  const existing = new Set(forwardReferences(before).map((v) => `${v.key}>${v.ref}`));
  const added = forwardReferences(after).find((v) => !existing.has(`${v.key}>${v.ref}`));
  return added ? reject("condition_forward_reference", added) : undefined;
}

/** Refuses a delete while a surviving condition references a deleted field. */
function checkUnreferenced(
  doc: Version,
  deletedFields: ReadonlySet<string>,
  deletedOwners: ReadonlySet<string>,
): Rejected | undefined {
  const keys = conditionOwners(doc)
    .filter((o) => !deletedOwners.has(o.key))
    .filter((o) => referencedKeys(o.condition).some((ref) => deletedFields.has(ref)))
    .map((o) => o.key);
  return keys.length ? reject("referenced_by_conditions", { keys: keys.join(",") }) : undefined;
}

function isLocalizedText(value: Record<string, unknown>): value is LocalizedText {
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(([k, v]) => (k === "en" || k === "es") && typeof v === "string")
  );
}

/** Removes `drop` from every localized text, found structurally; other strings stay. */
function stripLocale(node: unknown, drop: Locale): void {
  if (Array.isArray(node)) {
    for (const item of node) stripLocale(item, drop);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as Record<string, unknown>;
  if (isLocalizedText(record)) {
    if (drop === "en") delete record.en;
    else delete record.es;
    return;
  }
  for (const value of Object.values(record)) stripLocale(value, drop);
}

function isCompatibleChange(from: FieldTypeId, to: FieldTypeId): boolean {
  return COMPATIBLE_TYPE_CHANGES.some(
    ([a, b]) => (a === from && b === to) || (a === to && b === from),
  );
}

type Handler<K extends DraftCommand["kind"]> = (
  next: Version,
  command: Extract<DraftCommand, { kind: K }>,
  deps: CommandDeps,
  before: Version,
) => CommandResult;

const handlers: { [K in DraftCommand["kind"]]: Handler<K> } = {
  rename_form(next, { title }, { registry }) {
    next.title = title;
    return finish(next, registry);
  },

  set_languages(next, { languages, keep }, { registry }) {
    if (languages !== "bilingual" && languages !== next.languages) {
      if (keep !== languages)
        return reject("invalid_document", undefined, [
          { path: "keep", message: `keep must be ${languages} to drop the other language` },
        ]);
      stripLocale(next, languages === "en" ? "es" : "en");
    }
    next.languages = languages;
    return finish(next, registry);
  },

  add_page(next, { afterPageKey }, { registry, ids }) {
    let at = next.pages.length;
    if (afterPageKey !== undefined) {
      const pi = pageIndexOf(next, afterPageKey);
      if (pi < 0) return reject("unknown_page", { key: afterPageKey });
      at = pi + 1;
    }
    if (next.pages.length >= LIMITS.pagesPerForm)
      return reject("limit_pages", { max: LIMITS.pagesPerForm });
    const key = newKey(ids, "p");
    next.pages.splice(at, 0, { key, title: {}, fields: [] });
    return finish(next, registry, key);
  },

  update_page(next, { pageKey, title, description, visibility }, { registry }) {
    const page = next.pages[pageIndexOf(next, pageKey)];
    if (!page) return reject("unknown_page", { key: pageKey });
    if (title !== undefined) page.title = title;
    if (description === null) delete page.description;
    else if (description !== undefined) page.description = description;
    if (visibility === null) delete page.visibility;
    else if (visibility !== undefined) {
      page.visibility = visibility;
      const refused = checkOwnCondition(next, pageKey);
      if (refused) return refused;
    }
    return finish(next, registry);
  },

  move_page(next, { pageKey, toIndex }, { registry }, before) {
    const pi = pageIndexOf(next, pageKey);
    if (pi < 0) return reject("unknown_page", { key: pageKey });
    const max = next.pages.length - 1;
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > max)
      return reject("bad_index", { max });
    const [page] = next.pages.splice(pi, 1);
    if (page) next.pages.splice(toIndex, 0, page);
    return checkReorder(before, next) ?? finish(next, registry);
  },

  delete_page(next, { pageKey }, { registry }) {
    const pi = pageIndexOf(next, pageKey);
    const page = next.pages[pi];
    if (!page) return reject("unknown_page", { key: pageKey });
    if (next.pages.length === 1) return reject("last_page");
    const fields = new Set(page.fields.map((f) => f.key));
    const refused = checkUnreferenced(next, fields, new Set([pageKey, ...fields]));
    if (refused) return refused;
    next.pages.splice(pi, 1);
    return finish(next, registry);
  },

  add_field(next, { pageKey, type, afterFieldKey }, { registry, ids }) {
    const page = next.pages[pageIndexOf(next, pageKey)];
    if (!page) return reject("unknown_page", { key: pageKey });
    let at = page.fields.length;
    if (afterFieldKey !== undefined) {
      const fi = page.fields.findIndex((f) => f.key === afterFieldKey);
      if (fi < 0) return reject("unknown_field", { key: afterFieldKey });
      at = fi + 1;
    }
    if (isInput(registry, type) && inputCount(registry, page) >= LIMITS.inputFieldsPerPage)
      return reject("limit_fields", { max: LIMITS.inputFieldsPerPage });
    const key = newKey(ids, "f");
    // An unregistered type keeps `{}` and is reported by parseDraft.
    const settings: unknown = registry.has(type) ? registry.get(type).defaultSettings(ids) : {};
    const field: Field = {
      key,
      type,
      label: {},
      required: false,
      personal: false,
      validation: [],
      settings,
    };
    page.fields.splice(at, 0, field);
    return finish(next, registry, key);
  },

  update_field(next, { fieldKey, patch }, { registry }) {
    const found = locateField(next, fieldKey);
    const field = found?.page.fields[found.fi];
    if (!field) return reject("unknown_field", { key: fieldKey });
    if (patch.label !== undefined) field.label = patch.label;
    if (patch.help === null) delete field.help;
    else if (patch.help !== undefined) field.help = patch.help;
    if (patch.required !== undefined) field.required = patch.required;
    if (patch.personal !== undefined) field.personal = patch.personal;
    if (patch.validation !== undefined) field.validation = patch.validation;
    if (patch.settings !== undefined) field.settings = patch.settings;
    if (patch.visibility === null) delete field.visibility;
    else if (patch.visibility !== undefined) {
      field.visibility = patch.visibility;
      const refused = checkOwnCondition(next, fieldKey);
      if (refused) return refused;
    }
    return finish(next, registry);
  },

  change_field_type(next, { fieldKey, type }, { registry, ids }) {
    const found = locateField(next, fieldKey);
    const field = found?.page.fields[found.fi];
    if (!field) return reject("unknown_field", { key: fieldKey });
    if (!isCompatibleChange(field.type, type))
      return reject("incompatible_type", { from: field.type, to: type });
    if (!registry.has(type)) {
      field.type = type;
      return finish(next, registry);
    }
    const def = registry.get(type);
    // Settings the new type accepts carry over; otherwise the new type starts from its defaults.
    const carried = def.settingsSchema.safeParse(field.settings);
    field.type = type;
    field.validation = field.validation.filter((r) => def.allowedRules.includes(r.rule));
    field.settings = carried.success ? carried.data : def.defaultSettings(ids);
    return finish(next, registry);
  },

  move_field(next, { fieldKey, toPageKey, toIndex }, { registry }, before) {
    const found = locateField(next, fieldKey);
    if (!found) return reject("unknown_field", { key: fieldKey });
    const target = next.pages[pageIndexOf(next, toPageKey)];
    if (!target) return reject("unknown_page", { key: toPageKey });
    const [field] = found.page.fields.splice(found.fi, 1);
    if (!field) return reject("unknown_field", { key: fieldKey });
    const max = target.fields.length;
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > max)
      return reject("bad_index", { max });
    if (
      target !== found.page &&
      isInput(registry, field.type) &&
      inputCount(registry, target) >= LIMITS.inputFieldsPerPage
    )
      return reject("limit_fields", { max: LIMITS.inputFieldsPerPage });
    target.fields.splice(toIndex, 0, field);
    return checkReorder(before, next) ?? finish(next, registry);
  },

  delete_field(next, { fieldKey }, { registry }) {
    const found = locateField(next, fieldKey);
    if (!found) return reject("unknown_field", { key: fieldKey });
    const deleted = new Set<string>([fieldKey]);
    const refused = checkUnreferenced(next, deleted, deleted);
    if (refused) return refused;
    found.page.fields.splice(found.fi, 1);
    return finish(next, registry);
  },

  set_header_image(next, { image }, { registry }) {
    if (image === null) delete next.headerImage;
    else next.headerImage = { ref: image.ref, alt: image.alt };
    return finish(next, registry);
  },

  update_confirmation(next, { screen, email }, { registry }) {
    if (screen !== undefined) next.confirmation.screen = screen;
    if (email === null) delete next.confirmation.email;
    else if (email !== undefined) next.confirmation.email = email;
    return finish(next, registry);
  },
};

/**
 * Applies one command to a copy of the document; the input is never mutated.
 * The result always passes `parseDraft`. See specs/use-cases/create-and-edit-form.md.
 */
export function applyCommand(
  document: Version,
  command: DraftCommand,
  deps: CommandDeps,
): CommandResult {
  const handler = handlers[command.kind] as Handler<DraftCommand["kind"]>;
  return handler(structuredClone(document), command, deps, document);
}

/** Applies commands in order and stops at the first rejection, reporting its index. */
export function applyCommands(
  document: Version,
  commands: readonly DraftCommand[],
  deps: CommandDeps,
):
  | { ok: true; document: Version; createdKeys: Key[] }
  | { ok: false; index: number; rejection: CommandRejection } {
  let current = document;
  const createdKeys: Key[] = [];
  for (const [index, command] of commands.entries()) {
    const result = applyCommand(current, command, deps);
    if (!result.ok) return { ok: false, index, rejection: result.rejection };
    current = result.document;
    if (result.createdKey) createdKeys.push(result.createdKey);
  }
  return { ok: true, document: current, createdKeys };
}
