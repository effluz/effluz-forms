import {
  type Languages,
  type LocalizedText,
  requiredLocales,
} from "@/shared/domain/localized-text";
import { referencedKeys, type Condition } from "./condition";
import type { ExclusiveRole } from "./field-type";
import type { PublishIssue } from "./issues";
import { LIMITS } from "./limits";
import type { FieldTypeRegistry } from "./registry";
import {
  fieldIndex,
  inputFields,
  parseDraft,
  type Field,
  type ParseResult,
  type Version,
} from "./version";

export interface PublishContext {
  retentionMonths?: number;
}

const blank = (s: string | undefined) => s === undefined || s.trim().length === 0;

/** "blank" = empty in every required language; "partial" = some but not all; "ok" otherwise. */
function textStatus(
  text: LocalizedText | undefined,
  languages: Languages,
): { status: "ok" | "blank" | "partial"; missing: string[] } {
  const missing = requiredLocales(languages).filter((l) => blank(text?.[l]));
  const required = requiredLocales(languages).length;
  return {
    status: missing.length === 0 ? "ok" : missing.length === required ? "blank" : "partial",
    missing,
  };
}

export function collectsPersonalData(version: Version, registry: FieldTypeRegistry): boolean {
  return inputFields(version, registry).some(
    (f) => f.personal || registry.get(f.type).collectsPersonalData,
  );
}

export function checkDefinition(version: Version, registry: FieldTypeRegistry): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const L = version.languages;
  const push = (code: PublishIssue["code"], path: string, params?: PublishIssue["params"]) =>
    issues.push(params ? { code, path, params } : { code, path });

  const requireText = (
    text: LocalizedText | undefined,
    path: string,
    blankCode: PublishIssue["code"] | null,
  ) => {
    const { status, missing } = textStatus(text, L);
    if (status === "blank" && blankCode) push(blankCode, path);
    if (status === "partial")
      for (const lang of missing) push("missing_translation", path, { lang });
  };
  const optionalText = (text: LocalizedText | undefined, path: string) => {
    if (text) requireText(text, path, null);
  };

  if (inputFields(version, registry).length === 0) push("no_input", "pages");
  requireText(version.confirmation.screen, "confirmation/screen", "confirmation_missing");
  if (version.confirmation.email) {
    requireText(version.confirmation.email.subject, "confirmation/email/subject", "unlabeled");
    requireText(version.confirmation.email.body, "confirmation/email/body", "unlabeled");
  }
  if (version.headerImage) {
    const { status, missing } = textStatus(version.headerImage.alt, L);
    if (status !== "ok")
      for (const lang of status === "blank" ? requiredLocales(L) : missing)
        push("header_alt_missing", "headerImage/alt", { lang });
  }

  const index = fieldIndex(version);
  const pageStart = new Map<string, number>(); // page key -> order of its first field
  let order = 0;
  version.pages.forEach((page) => {
    pageStart.set(page.key, order);
    order += page.fields.length;
  });

  const checkCondition = (cond: Condition, ownOrder: number, path: string) => {
    for (const ref of referencedKeys(cond)) {
      const target = index.get(ref);
      if (!target || target.order >= ownOrder) push("dangling_condition", path, { ref });
    }
  };

  // Exclusive roles in order of first appearance, with the first holder's code and params.
  const roles = new Map<string, { role: ExclusiveRole; count: number }>();

  version.pages.forEach((page, pi) => {
    const pPath = `pages/${String(pi)}`;
    requireText(page.title, `${pPath}/title`, "unlabeled");
    optionalText(page.description, `${pPath}/description`);
    if (page.visibility)
      checkCondition(page.visibility, pageStart.get(page.key) ?? 0, `${pPath}/visibility`);

    page.fields.forEach((field: Field, fi) => {
      const fPath = `${pPath}/fields/${String(fi)}`;
      const def = registry.get(field.type);
      if (def.isInput) requireText(field.label, `${fPath}/label`, "unlabeled");
      optionalText(field.help, `${fPath}/help`);
      if (field.visibility)
        checkCondition(field.visibility, index.get(field.key)?.order ?? 0, `${fPath}/visibility`);

      // A never-hidden field cannot be conditional; consent is the only such type (ADR 0016).
      if (def.neverHidden && (field.visibility || page.visibility)) push("consent_missing", fPath);
      for (const entry of def.localizedSettingsTexts?.(field.settings) ?? []) {
        const path = `${fPath}/settings/${entry.path}`;
        if (entry.blankCode) requireText(entry.text, path, entry.blankCode);
        else optionalText(entry.text, path);
      }
      for (const draft of def.publishChecks?.(field, field.settings) ?? [])
        push(draft.code, `${fPath}/${draft.path}`, draft.params);
      for (const role of def.exclusiveRoles?.(field.settings) ?? []) {
        const seen = roles.get(role.role);
        roles.set(role.role, { role: seen?.role ?? role, count: (seen?.count ?? 0) + 1 });
      }
      const cap = def.maxLength;
      if (cap !== undefined)
        for (const rule of field.validation)
          if ((rule.rule === "min_length" || rule.rule === "max_length") && rule.value > cap)
            push("over_maximum", `${fPath}/validation`, {
              detail: `${rule.rule} ${String(rule.value)} > ${String(cap)}`,
            });
    });
  });

  for (const { role, count } of roles.values())
    if (count > 1) push(role.code, "pages", role.params);
  const hasConsent = inputFields(version, registry).some(
    (f) => registry.get(f.type).consentRecord !== undefined,
  );
  if (!hasConsent && collectsPersonalData(version, registry)) push("consent_missing", "pages");
  return issues;
}

export function validateForPublish(
  version: Version,
  registry: FieldTypeRegistry,
  ctx: PublishContext,
): PublishIssue[] {
  const issues = checkDefinition(version, registry);
  const r = ctx.retentionMonths;
  if (
    r === undefined ||
    !Number.isInteger(r) ||
    r < LIMITS.retentionMonthsMin ||
    r > LIMITS.retentionMonthsMax
  )
    issues.push({ code: "retention_missing", path: "settings/retention" });
  return issues;
}

export function parseVersion(input: unknown, registry: FieldTypeRegistry): ParseResult {
  const draft = parseDraft(input, registry);
  if (!draft.ok) return draft;
  const issues = checkDefinition(draft.version, registry);
  if (issues.length)
    return {
      ok: false,
      issues: issues.map((i) => ({
        path: i.path,
        message: `${i.code}${i.params ? " " + JSON.stringify(i.params) : ""}`,
      })),
    };
  return draft;
}
