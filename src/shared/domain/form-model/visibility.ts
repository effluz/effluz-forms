import { evaluateCondition } from "./condition";
import type { FieldTypeRegistry } from "./registry";
import type { Page, Version } from "./version";

export interface Visibility {
  pages: ReadonlyMap<string, boolean>;
  fields: ReadonlyMap<string, boolean>;
  visibleAnswers: Record<string, unknown>;
}

/**
 * Without a registry, every type but "section" counts as an input and every
 * field obeys its conditions. With one, the registry's `isInput` decides, and
 * `neverHidden` types are always visible.
 */
export function evaluateVisibility(
  version: Version,
  answers: Readonly<Record<string, unknown>>,
  registry?: FieldTypeRegistry,
): Visibility {
  const pages = new Map<string, boolean>();
  const fields = new Map<string, boolean>();
  const visibleAnswers: Record<string, unknown> = {};
  for (const page of version.pages) {
    const pageVisible = page.visibility ? evaluateCondition(page.visibility, visibleAnswers) : true;
    pages.set(page.key, pageVisible);
    for (const field of page.fields) {
      const def = registry?.get(field.type);
      const isInput = def ? def.isInput : field.type !== "section";
      const visible =
        def?.neverHidden === true ||
        (pageVisible &&
          (field.visibility ? evaluateCondition(field.visibility, visibleAnswers) : true));
      fields.set(field.key, visible);
      if (visible && isInput && Object.hasOwn(answers, field.key))
        visibleAnswers[field.key] = answers[field.key];
    }
  }
  return { pages, fields, visibleAnswers };
}

/** The pages the conditions show, in document order (`specs/form-definition.md`, "Conditional logic"). */
export function visiblePages(
  version: Version,
  answers: Readonly<Record<string, unknown>>,
  registry: FieldTypeRegistry,
): Page[] {
  const { pages } = evaluateVisibility(version, answers, registry);
  return version.pages.filter((p) => pages.get(p.key) === true);
}
