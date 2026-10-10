import { evaluateCondition } from "./condition";
import type { ValidationCode, ValidationIssue } from "./issues";
import type { Key } from "./keys";
import type { FieldTypeRegistry } from "./registry";
import { evaluateRule, ruleParams } from "./rules";
import type { Field, Version } from "./version";

export interface SubmissionContext {
  today: string;
}

export type SubmissionResult =
  | { ok: true; answers: Record<string, unknown>; consent?: { fieldKey: Key; textVersion: string } }
  | { ok: false; issues: ValidationIssue[] };

export function isAbsent(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw === "string") return raw.trim().length === 0;
  if (Array.isArray(raw)) return raw.length === 0;
  return false;
}

function dedupe(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((i, idx) => issues.findIndex((j) => j.code === i.code) === idx);
}

function issuesFor(
  field: Field,
  registry: FieldTypeRegistry,
  raw: unknown,
  ctx: SubmissionContext,
): { issues: ValidationIssue[]; normalized?: unknown } {
  const def = registry.get(field.type);
  const key = field.key;
  const issue = (code: ValidationCode, params?: ValidationIssue["params"]): ValidationIssue =>
    params ? { code, field: key, params } : { code, field: key };

  if (isAbsent(raw)) {
    if (def.id === "consent") return { issues: [issue("consent")] };
    return { issues: field.required ? [issue("required")] : [] };
  }
  const shape = def.answerSchema.safeParse(raw);
  if (!shape.success) return { issues: [issue("invalid_shape")] };
  const normalized = def.normalize(shape.data, field.settings);
  if (def.isEmpty(normalized)) {
    if (def.id === "consent") return { issues: [issue("consent")] };
    // An empty-but-present value such as checkbox false is still an answer when not required.
    return { issues: field.required ? [issue("required")] : [], normalized };
  }
  const intrinsic = def.validate(normalized, field.settings);
  if (intrinsic.length > 0) {
    // Rules assume a well-formed answer, so they are skipped when the type's own check failed.
    const failed = intrinsic.map((code) =>
      code === "max_length" && def.maxLength !== undefined
        ? issue(code, { n: def.maxLength })
        : issue(code),
    );
    return { issues: dedupe(failed), normalized };
  }
  const issues: ValidationIssue[] = [];
  for (const rule of field.validation) {
    const code = evaluateRule(rule, normalized, ctx);
    if (code) {
      const params = ruleParams(rule);
      issues.push(issue(code, Object.keys(params).length ? params : undefined));
    }
  }
  return { issues: dedupe(issues), normalized };
}

export function validateSubmission(
  version: Version,
  registry: FieldTypeRegistry,
  raw: Readonly<Record<string, unknown>>,
  ctx: SubmissionContext,
): SubmissionResult {
  const answers: Record<string, unknown> = {};
  const issues: ValidationIssue[] = [];
  let consent: { fieldKey: Key; textVersion: string } | undefined;

  for (const page of version.pages) {
    const pageVisible = page.visibility ? evaluateCondition(page.visibility, answers) : true;
    if (!pageVisible) continue;
    for (const field of page.fields) {
      const def = registry.get(field.type);
      if (!def.isInput) continue;
      const visible = field.visibility ? evaluateCondition(field.visibility, answers) : true;
      if (!visible) continue;
      const own = Object.hasOwn(raw, field.key) ? raw[field.key] : undefined;
      const result = issuesFor(field, registry, own, ctx);
      issues.push(...result.issues);
      if (result.issues.length === 0 && result.normalized !== undefined) {
        answers[field.key] = result.normalized;
        if (def.id === "consent")
          consent = {
            fieldKey: field.key,
            textVersion: (result.normalized as { textVersion: string }).textVersion,
          };
      }
    }
  }
  if (issues.length) return { ok: false, issues };
  return consent ? { ok: true, answers, consent } : { ok: true, answers };
}
