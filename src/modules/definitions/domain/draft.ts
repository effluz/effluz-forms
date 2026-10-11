import {
  buildDefaultRegistry,
  newKey,
  parseDraft,
  type Clause,
  type Condition,
  type Field,
  type Key,
  type Page,
  type Version,
} from "@/shared/domain/form-model";
import type { Languages, LocalizedText } from "@/shared/domain/localized-text";

/** The working copy of a form. See specs/form-definition.md, "Concepts". */
export interface Draft {
  formId: string;
  revision: number;
  document: Version;
  updatedBy: string | null;
  updatedAt: Date;
  auditedBy: string | null;
  auditedAt: Date | null;
}

/** Structural twin of the application layer's id generator; a domain cannot import it. */
export interface IdSource {
  newId(): string;
}

function parseOrThrow(document: unknown): Version {
  const result = parseDraft(document, buildDefaultRegistry());
  if (!result.ok)
    throw new Error(`generated document is invalid: ${JSON.stringify(result.issues)}`);
  return result.version;
}

/** A new draft's document: one empty page. See specs/use-cases/create-and-edit-form.md, "Main flow: create". */
export function emptyDocument(title: LocalizedText, languages: Languages, ids: IdSource): Version {
  return parseOrThrow({
    title,
    languages,
    pages: [{ key: newKey(ids, "p"), title: {}, fields: [] }],
    confirmation: { screen: {} },
  });
}

interface KeyMaps {
  keys: Map<string, Key>;
  /** Old field key to (old option key to new option key). */
  options: Map<string, Map<string, Key>>;
}

interface WithOptions {
  options: { key: string }[];
}

function hasOptions(settings: unknown): settings is WithOptions & Record<string, unknown> {
  if (typeof settings !== "object" || settings === null) return false;
  const options = (settings as { options?: unknown }).options;
  return (
    Array.isArray(options) &&
    options.every(
      (o) =>
        typeof o === "object" && o !== null && typeof (o as { key?: unknown }).key === "string",
    )
  );
}

function remapSettings(field: Field, ids: IdSource, maps: KeyMaps): unknown {
  const settings: unknown = structuredClone(field.settings);
  if (!hasOptions(settings)) return settings;
  const optionMap = new Map<string, Key>();
  for (const option of settings.options) {
    const fresh = newKey(ids, "o");
    optionMap.set(option.key, fresh);
    option.key = fresh;
  }
  maps.options.set(field.key, optionMap);
  return settings;
}

function remapClause(clause: Clause, maps: KeyMaps): Clause {
  const optionMap = maps.options.get(clause.field);
  const swap = (value: string | number | boolean): string | number | boolean =>
    typeof value === "string" ? (optionMap?.get(value) ?? value) : value;
  const field = maps.keys.get(clause.field) ?? clause.field;
  const { value } = clause;
  if (value === undefined) return { field, op: clause.op };
  return {
    field,
    op: clause.op,
    value: Array.isArray(value) ? value.map(swap) : swap(value),
  };
}

function remapCondition(condition: Condition, maps: KeyMaps): Condition {
  if ("all" in condition) return { all: condition.all.map((c) => remapClause(c, maps)) };
  if ("any" in condition) return { any: condition.any.map((c) => remapClause(c, maps)) };
  return remapClause(condition, maps);
}

/**
 * Copies a document for a new form: every page, field and option gets a fresh
 * key, conditions follow the new keys, the header image is dropped (its media
 * belongs to the source form) and the title is replaced.
 * See specs/use-cases/create-and-edit-form.md, "Main flow: create".
 */
export function duplicateDocument(source: Version, title: LocalizedText, ids: IdSource): Version {
  const maps: KeyMaps = { keys: new Map(), options: new Map() };
  for (const page of source.pages) {
    maps.keys.set(page.key, newKey(ids, "p"));
    for (const field of page.fields) maps.keys.set(field.key, newKey(ids, "f"));
  }

  const copyField = (field: Field): Field => {
    const settings = remapSettings(field, ids, maps);
    return {
      ...structuredClone(field),
      key: maps.keys.get(field.key) ?? field.key,
      settings,
    };
  };
  const pages: Page[] = source.pages.map((page) => ({
    ...structuredClone(page),
    key: maps.keys.get(page.key) ?? page.key,
    fields: page.fields.map(copyField),
  }));
  // Conditions are rewritten last so option maps of later fields are known.
  const rewritten = pages.map((page) => ({
    ...page,
    ...(page.visibility ? { visibility: remapCondition(page.visibility, maps) } : {}),
    fields: page.fields.map((field) => ({
      ...field,
      ...(field.visibility ? { visibility: remapCondition(field.visibility, maps) } : {}),
    })),
  }));

  const copy = { ...structuredClone(source), title, pages: rewritten };
  delete copy.headerImage;
  return parseOrThrow(copy);
}

/** A save within this window by the same person does not write another audit entry. */
export const DRAFT_AUDIT_WINDOW_MS = 5 * 60 * 1000;

/** Collapses a burst of autosaves into one audit entry. See specs/use-cases/create-and-edit-form.md, "Audit entries". */
export function shouldAuditSave(draft: Draft, actorEmail: string, now: Date): boolean {
  if (draft.auditedBy !== actorEmail || draft.auditedAt === null) return true;
  return now.getTime() - draft.auditedAt.getTime() >= DRAFT_AUDIT_WINDOW_MS;
}
