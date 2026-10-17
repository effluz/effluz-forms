import { LIMITS, type UploadLimits, type ValidationIssue } from "@/shared/domain/form-model";
import type { Locale } from "@/shared/domain/localized-text";
import { fill } from "@/shared/presentation/copy";
import { catalog, isOne, t } from "./copy";
import { formatIsoDate, formatMegabytes, formatNumber, kindsKey } from "./format";

/**
 * The codes a refused file can carry. Structural twins of the application layer's
 * `FileIssueCode` and `UploadRefusal`, kept here so presentation does not import the
 * application layer for two unions.
 */
export type FileMessageCode =
  | "file_too_large"
  | "file_wrong_type"
  | "file_unreadable"
  | "upload_failed"
  | "submission_too_large";
export type UploadRefusalCode =
  | "file_too_large"
  | "file_wrong_type"
  | "file_unreadable"
  | "files_max"
  | "submission_too_large"
  | "not_allowed"
  | "expired";

type Vars = Record<string, string>;

function rowFor(code: string, n?: number, locale?: Locale) {
  const key = code.replaceAll("_", " ");
  const one = `${key} one`;
  if (n !== undefined && locale !== undefined && isOne(locale, n) && Object.hasOwn(catalog, one)) {
    return catalog[one as keyof typeof catalog];
  }
  // Every code has a row (copy.test.ts); an unknown one reads as an unexpected value.
  return Object.hasOwn(catalog, key)
    ? catalog[key as keyof typeof catalog]
    : catalog["invalid shape"];
}

/**
 * The message for a validation issue, built from the rule and the field label
 * (specs/ui-ux/renderer.md, "Message catalog").
 */
export function issueMessage(
  issue: Pick<ValidationIssue, "code" | "params">,
  label: string,
  locale: Locale,
): string {
  const params = issue.params ?? {};
  const n = typeof params["n"] === "number" ? params["n"] : undefined;
  const vars: Vars = { label };
  if (n !== undefined) vars["n"] = formatNumber(n, locale);
  if (typeof params["date"] === "string") vars["date"] = formatIsoDate(params["date"], locale);
  return fill(rowFor(issue.code, n, locale)[locale], vars);
}

/** The message for a refused file; `params.maxMb`, when given, is `{size}`. */
export function fileIssueMessage(
  issue: { code: FileMessageCode; name: string; params?: Readonly<Record<string, number>> },
  limits: UploadLimits,
  locale: Locale,
): string {
  const megabytes =
    issue.code === "submission_too_large"
      ? LIMITS.submissionSizeMb
      : (issue.params?.["maxMb"] ?? limits.maxSizeMb);
  return fill(rowFor(issue.code)[locale], {
    file: issue.name,
    size: formatMegabytes(megabytes, locale),
    kinds: t(locale, kindsKey(limits.kinds)),
  });
}

/** The message for an early upload the server refused. */
export function uploadRefusalMessage(
  code: UploadRefusalCode,
  ctx: { file: string; label: string; limits: UploadLimits },
  locale: Locale,
): string {
  if (code === "files_max") {
    return issueMessage(
      { code: "files_max", params: { n: ctx.limits.maxFiles } },
      ctx.label,
      locale,
    );
  }
  const fileCode = code === "expired" || code === "not_allowed" ? "upload_failed" : code;
  return fileIssueMessage({ code: fileCode, name: ctx.file }, ctx.limits, locale);
}

/** The heading of the error summary above a page's first field. */
export function errorSummaryHeading(count: number, locale: Locale): string {
  if (isOne(locale, count)) return t(locale, "error_summary_heading_one");
  return t(locale, "error_summary_heading", { count: formatNumber(count, locale) });
}

/** "{count} of {max} files" beside a file field, singular when the maximum is one. */
export function filesCount(count: number, max: number, locale: Locale): string {
  const vars = { count: formatNumber(count, locale), max: formatNumber(max, locale) };
  return isOne(locale, max) ? t(locale, "files_count_one", vars) : t(locale, "files_count", vars);
}
