import {
  evaluateVisibility,
  validatePage,
  type FieldTypeRegistry,
  type ValidationIssue,
  type Version,
} from "@/shared/domain/form-model";
import { withFileAnswers, type InProgress } from "../domain/in-progress";
import { omitKeys, pageInputKeys, pick, storePageAnswers, withOverrides } from "./answers";
import type { PagePost } from "./fill-state";

/**
 * Validates one posted page against the locked record and returns the
 * record's answers with the page's valid ones stored, plus the page's issues.
 * Decode and count issues replace the form model's issue for their field, and
 * a field with one is never stored. Shared by every page post and Submit; see
 * specs/ui-ux/renderer.md, "Navigation and state".
 */
export function checkPostedPage(
  registry: FieldTypeRegistry,
  input: {
    version: Version;
    record: InProgress;
    post: PagePost;
    today: string;
    enforceRequired: boolean;
    /** Count issues of the post's files, from `mergeBatch`. */
    countIssues: readonly ValidationIssue[];
  },
): { answers: Record<string, unknown>; issues: ValidationIssue[] } {
  const { version, record, post } = input;
  const keys = pageInputKeys(version, registry, post.pageKey);
  // The body is the stored answers of the other pages plus only this page's posted keys, so
  // a post cannot name an earlier page's key to steer a condition.
  const stored = omitKeys(record.answers, keys.answers);
  const body = withFileAnswers({ ...stored, ...pick(post.answers, keys.answers) }, record.files);
  const validation = validatePage(
    version,
    registry,
    body,
    post.pageKey,
    { today: input.today },
    { enforceRequired: input.enforceRequired },
  );

  const visible = evaluateVisibility(version, body, registry).fields;
  const decodeIssues = post.decodeIssues.filter(
    (i) => keys.answers.includes(i.field) && visible.get(i.field) === true,
  );
  const overrides = [...decodeIssues, ...input.countIssues];
  const overridden = new Set<string>(overrides.map((i) => i.field));
  const valid = Object.fromEntries(
    Object.entries(validation.answers).filter(([k]) => !overridden.has(k)),
  );
  return {
    answers: storePageAnswers(record.answers, version, registry, post.pageKey, valid),
    issues: withOverrides(validation.issues, overrides),
  };
}
