import { evaluateCondition } from "./condition";
import type { Version } from "./version";

export interface Visibility {
  pages: ReadonlyMap<string, boolean>;
  fields: ReadonlyMap<string, boolean>;
  visibleAnswers: Record<string, unknown>;
}

export function evaluateVisibility(
  version: Version,
  answers: Readonly<Record<string, unknown>>,
): Visibility {
  const pages = new Map<string, boolean>();
  const fields = new Map<string, boolean>();
  const visibleAnswers: Record<string, unknown> = {};
  for (const page of version.pages) {
    const pageVisible = page.visibility ? evaluateCondition(page.visibility, visibleAnswers) : true;
    pages.set(page.key, pageVisible);
    for (const field of page.fields) {
      const visible =
        pageVisible &&
        (field.visibility ? evaluateCondition(field.visibility, visibleAnswers) : true);
      fields.set(field.key, visible);
      if (visible && field.type !== "section" && Object.hasOwn(answers, field.key))
        visibleAnswers[field.key] = answers[field.key];
    }
  }
  return { pages, fields, visibleAnswers };
}
