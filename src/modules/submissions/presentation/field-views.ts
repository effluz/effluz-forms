import type { FormVersion } from "@/modules/definitions/application";
import {
  evaluateVisibility,
  type Field,
  type FieldTypeRegistry,
  type UploadLimits,
} from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import { withFileAnswers, type PageView, type ViewResult } from "../application";
import { t } from "./copy";
import { fieldRenderers, type FieldProps, type FileRowView, type FormValues } from "./fields";
import { formatBytes } from "./format";
import { fileIssueMessage, issueMessage } from "./messages";
import type { FillPostState, RefusedFileMessage } from "./page-form-state";

/** One field with an error, as the page's error summary links to it. */
export interface SummaryItem {
  fieldKey: string;
  href: string;
  message: string;
}

interface PageViewInput {
  version: FormVersion;
  page: PageView;
}

/** The visible fields of the page the record is on, in document order. */
function visibleFields(view: PageViewInput, registry: FieldTypeRegistry): Field[] {
  const { document } = view.version;
  const page = document.pages.find((p) => p.key === view.page.pageKey);
  if (!page) return [];
  const { fields } = evaluateVisibility(
    document,
    withFileAnswers(view.page.answers, view.page.files),
    registry,
  );
  return page.fields.filter((field) => fields.get(field.key) === true);
}

/** The values a field's controls start with: the refused post's, else the stored answer's. */
function valuesFor(field: Field, page: PageView): FormValues {
  if (page.pending) {
    const values: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(page.pending.raw))
      if (name === field.key || name.startsWith(`${field.key}.`)) values[name] = value;
    return values;
  }
  return fieldRenderers[field.type].encode(page.answers[field.key], field);
}

/** The staff help, then the selection limits a multiple choice field enforces. */
function helpFor(field: Field, label: string, view: PageViewInput): string | null {
  const { locale } = view.page;
  const { languages } = view.version.document;
  const parts: string[] = [];
  const staff = field.help ? resolveText(field.help, locale, languages) : "";
  if (staff !== "") parts.push(staff);
  for (const rule of field.validation) {
    if (rule.rule === "min_selected")
      parts.push(issueMessage({ code: "choice_min", params: { n: rule.value } }, label, locale));
    if (rule.rule === "max_selected")
      parts.push(issueMessage({ code: "choice_max", params: { n: rule.value } }, label, locale));
  }
  return parts.length === 0 ? null : parts.join("\n\n");
}

/**
 * The visible fields of the current page with what each renderer needs: label, help, values,
 * error and staged files. See specs/ui-ux/renderer.md, "Field rendering".
 */
export function pageFieldViews(
  view: PageViewInput & { slug: string },
  registry: FieldTypeRegistry,
): { field: Field; props: FieldProps }[] {
  const { page } = view;
  const { languages } = view.version.document;
  return visibleFields(view, registry).map((field) => {
    const def = registry.get(field.type);
    const label = resolveText(field.label, page.locale, languages);
    const issue = page.pending?.issues.find((i) => i.field === field.key);
    const files: FileRowView[] = (page.files[field.key] ?? []).map((file, index) => {
      const size = formatBytes(file.size, page.locale);
      return {
        id: file.id,
        kind: file.kind,
        label: t(page.locale, "file_row", { n: String(index + 1), size }),
        size,
      };
    });
    return {
      field,
      props: {
        field,
        locale: page.locale,
        languages,
        slug: view.slug,
        label,
        help: helpFor(field, label, view),
        required: def.isInput && (field.required || def.alwaysRequired === true),
        values: valuesFor(field, page),
        error: issue ? issueMessage(issue, label, page.locale) : null,
        files,
      },
    };
  });
}

/** The first control of a field: dates start at the part their language writes first. */
function firstControl(field: Field, locale: PageView["locale"]): string {
  if (field.type !== "date") return `#f-${field.key}`;
  return `#f-${field.key}-${locale === "en" ? "month" : "day"}`;
}

/** The fields with an error, in page order, for the error summary. */
export function summaryItems(view: PageViewInput, registry: FieldTypeRegistry): SummaryItem[] {
  const items: SummaryItem[] = [];
  for (const { field, props } of pageFieldViews({ ...view, slug: "" }, registry))
    if (props.error !== null)
      items.push({
        fieldKey: field.key,
        href: firstControl(field, view.page.locale),
        message: props.error,
      });
  return items;
}

/**
 * The page-1 heading is the form's title and the page title becomes its subtitle; later
 * pages lead with their own title. See specs/ui-ux/renderer.md, "Form page".
 */
export function pageTitle(view: Extract<ViewResult, { screen: "page" }>): {
  h1: string;
  documentTitle: string;
  subtitle: string | null;
} {
  const { document } = view.version;
  const { locale } = view.page;
  const formTitle = resolveText(document.title, locale, document.languages);
  const page = document.pages.find((p) => p.key === view.page.pageKey);
  const title = page ? resolveText(page.title, locale, document.languages) : "";
  if (view.page.isFirst)
    return {
      h1: formTitle,
      documentTitle: formTitle,
      subtitle: title !== "" && title !== formTitle ? title : null,
    };
  if (title === "") return { h1: formTitle, documentTitle: formTitle, subtitle: null };
  return { h1: title, documentTitle: `${formTitle}: ${title}`, subtitle: null };
}

/** The cookie's refused files that belong to this page, as messages in the page's language. */
export function refusedFileMessages(
  state: FillPostState | null,
  view: PageViewInput,
  registry: FieldTypeRegistry,
): RefusedFileMessage[] {
  if (state === null || state.page !== view.page.position.n) return [];
  const { locale } = view.page;
  const limits = new Map<string, UploadLimits>();
  for (const field of visibleFields(view, registry)) {
    const def = registry.get(field.type);
    if (def.uploadLimits)
      limits.set(field.key, def.uploadLimits(def.settingsSchema.parse(field.settings)));
  }
  const messages: RefusedFileMessage[] = [];
  state.refusedFiles.forEach((entry, index) => {
    const uploadLimits = limits.get(entry.field);
    if (!uploadLimits) return;
    const name =
      entry.name === "" ? t(locale, "file_unnamed", { n: String(index + 1) }) : entry.name;
    messages.push({
      fieldKey: entry.field,
      message: fileIssueMessage(
        { code: entry.code, name, params: entry.params },
        uploadLimits,
        locale,
      ),
    });
  });
  return messages;
}
