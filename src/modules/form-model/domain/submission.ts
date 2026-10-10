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

  const demanded = field.required || def.alwaysRequired === true;
  const requiredCode = def.requiredCode ?? "required";
  if (isAbsent(raw)) {
    if (demanded) return { issues: [issue(requiredCode)] };
    // Omitting a must_be_true answer must not bypass the rule that sending false fails.
    if (field.validation.some((r) => r.rule === "must_be_true"))
      return { issues: [issue("must_be_true")] };
    return { issues: [] };
  }
  const shape = def.answerSchema.safeParse(raw);
  if (!shape.success) {
    // An always-required type reports its own code, never a shape error (consent, for one).
    return {
      issues: [issue(def.alwaysRequired ? (def.requiredCode ?? "invalid_shape") : "invalid_shape")],
    };
  }
  const normalized = def.normalize(shape.data, field.settings);
  if (def.isEmpty(normalized) && demanded) return { issues: [issue(requiredCode)] };
  // A non-required answer that normalizes to blank (or an empty list) is no answer at all.
  if (def.isEmpty(normalized) && isAbsent(normalized)) return { issues: [] };
  // A non-required empty-but-present value such as checkbox false is still an answer,
  // so the intrinsic check and the rules still run on it.
  const intrinsic = def.validate(normalized, field.settings);
  if (intrinsic.length > 0) {
    // Rules assume a well-formed answer, so they are skipped when the type's own check failed.
    const failed = intrinsic.map((o) =>
      typeof o === "string" ? issue(o) : issue(o.code, o.params),
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
  rawBody: Readonly<Record<string, unknown>>,
  ctx: SubmissionContext,
): SubmissionResult {
  // The type promises an object, but the body comes off the wire, so guard it anyway.
  const untrusted: unknown = rawBody;
  const body: Readonly<Record<string, unknown>> =
    typeof untrusted === "object" && untrusted !== null
      ? (untrusted as Record<string, unknown>)
      : {};
  const answers: Record<string, unknown> = {};
  const issues: ValidationIssue[] = [];
  let consent: { fieldKey: Key; textVersion: string } | undefined;

  for (const page of version.pages) {
    const pageVisible = page.visibility ? evaluateCondition(page.visibility, answers) : true;
    for (const field of page.fields) {
      const def = registry.get(field.type);
      if (!def.isInput) continue;
      // A never-hidden type (consent) cannot be skipped by any condition.
      const visible =
        def.neverHidden === true ||
        (pageVisible && (field.visibility ? evaluateCondition(field.visibility, answers) : true));
      if (!visible) continue;
      const own = Object.hasOwn(body, field.key) ? body[field.key] : undefined;
      const result = issuesFor(field, registry, own, ctx);
      issues.push(...result.issues);
      if (result.issues.length === 0 && result.normalized !== undefined) {
        answers[field.key] = result.normalized;
        if (def.consentRecord)
          consent = { fieldKey: field.key, ...def.consentRecord(result.normalized) };
      }
    }
  }
  if (issues.length) return { ok: false, issues };
  return consent ? { ok: true, answers, consent } : { ok: true, answers };
}
