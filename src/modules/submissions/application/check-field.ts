import {
  validatePage,
  type Field,
  type ValidationCode,
  type ValidationIssue,
} from "@/shared/domain/form-model";
import { asKey } from "@/shared/domain/form-model";
import { todayIn } from "../domain/dates";
import { withFileAnswers } from "../domain/in-progress";
import { pageInputKeys } from "./answers";
import type { SubmissionsDeps } from "./deps";
import type { OpenContext } from "./post-context";

/**
 * The blur check: the server's own rules for one field, so the browser ships
 * none of them. The conditions are judged by the record's stored answers
 * (same-page siblings included) plus this one answer. Null when the version has no such input field.
 * See specs/ui-ux/renderer.md, "Validation and errors".
 */
export function checkField(
  deps: SubmissionsDeps,
  context: OpenContext,
  input: { fieldKey: string; answer: unknown; decodeIssue: ValidationCode | null },
): { field: Field; issue: ValidationIssue | null } | null {
  const { document } = context.version;
  for (const page of document.pages) {
    const field = page.fields.find((f) => f.key === input.fieldKey);
    if (!field) continue;
    if (!deps.registry.get(field.type).isInput) return null;
    if (input.decodeIssue !== null)
      return { field, issue: { code: input.decodeIssue, field: asKey(field.key) } };

    const record = context.record;
    const keys = pageInputKeys(document, deps.registry, page.key);
    // The stored answers (same-page siblings included) plus this one answer, as Next would see
    // them, so a blur check reports what Next reports.
    const stored = record?.answers ?? {};
    const body = withFileAnswers(
      keys.answers.includes(field.key) ? { ...stored, [field.key]: input.answer } : stored,
      record?.files ?? {},
    );
    const { issues } = validatePage(
      document,
      deps.registry,
      body,
      page.key,
      { today: todayIn(context.form.settings.timezone, deps.clock.now()) },
      { enforceRequired: true },
    );
    return { field, issue: issues.find((i) => i.field === field.key) ?? null };
  }
  return null;
}
