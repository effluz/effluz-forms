import {
  type Languages,
  type LocalizedText,
  requiredLocales,
} from "@/shared/domain/localized-text";
import { referencedKeys, type Condition } from "./condition";
import { isConsentChecklistComplete } from "./field-types/consent";
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

  let submitterEmails = 0;
  let consentFields = 0;

  version.pages.forEach((page, pi) => {
    const pPath = `pages/${String(pi)}`;
    requireText(page.title, `${pPath}/title`, "unlabeled");
    optionalText(page.description, `${pPath}/description`);
    if (page.visibility)
      checkCondition(page.visibility, pageStart.get(page.key) ?? 0, `${pPath}/visibility`);

    page.fields.forEach((field: Field, fi) => {
      const fPath = `${pPath}/fields/${String(fi)}`;
      const def = registry.get(field.type);
      const settings = field.settings as Record<string, unknown>;
      if (def.isInput) requireText(field.label, `${fPath}/label`, "unlabeled");
      optionalText(field.help, `${fPath}/help`);
      if (field.visibility)
        checkCondition(field.visibility, index.get(field.key)?.order ?? 0, `${fPath}/visibility`);

      if (def.id === "section") {
        requireText(settings["title"] as LocalizedText, `${fPath}/settings/title`, "unlabeled");
        optionalText(
          settings["description"] as LocalizedText | undefined,
          `${fPath}/settings/description`,
        );
      }
      if (def.id === "single_choice" || def.id === "multiple_choice") {
        const options = settings["options"] as { key: string; label: LocalizedText }[];
        options.forEach((o, oi) => {
          requireText(o.label, `${fPath}/settings/options/${String(oi)}/label`, "option_unlabeled");
        });
        for (const rule of field.validation)
          if (
            (rule.rule === "min_selected" || rule.rule === "max_selected") &&
            rule.value > options.length
          )
            push("over_maximum", `${fPath}/validation`, {
              detail: `${rule.rule} ${String(rule.value)} > ${String(options.length)} options`,
            });
      }
      if (def.id === "email" && settings["isSubmitterAddress"] === true) submitterEmails++;
      if (def.id === "consent") {
        consentFields++;
        // A consent field is never conditional: hiding it would skip the agreement.
        if (field.visibility || page.visibility) push("consent_missing", fPath);
        requireText(settings["text"] as LocalizedText, `${fPath}/settings/text`, "unlabeled");
        if (
          !isConsentChecklistComplete(settings as Parameters<typeof isConsentChecklistComplete>[0])
        )
          push("consent_checklist", `${fPath}/settings/coveredItems`);
      }
      if (def.id === "short_text" || def.id === "long_text") {
        const cap = def.id === "short_text" ? LIMITS.shortTextMax : LIMITS.longTextMax;
        for (const rule of field.validation)
          if ((rule.rule === "min_length" || rule.rule === "max_length") && rule.value > cap)
            push("over_maximum", `${fPath}/validation`, {
              detail: `${rule.rule} ${String(rule.value)} > ${String(cap)}`,
            });
      }
      if (def.id === "file_upload") {
        const maxFiles = settings["maxFiles"] as number;
        for (const rule of field.validation)
          if ((rule.rule === "min_files" || rule.rule === "max_files") && rule.value > maxFiles)
            push("over_maximum", `${fPath}/validation`, {
              detail: `${rule.rule} ${String(rule.value)} > ${String(maxFiles)} files`,
            });
      }
    });
  });

  if (submitterEmails > 1) push("submitter_email_dup", "pages");
  if (consentFields > 1) push("over_maximum", "pages", { detail: "more than one consent field" });
  if (consentFields === 0 && collectsPersonalData(version, registry))
    push("consent_missing", "pages");
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
