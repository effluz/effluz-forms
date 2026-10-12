import {
  evaluateVisibility,
  type Field,
  type FieldTypeRegistry,
  type UploadLimits,
  type ValidationIssue,
  type Version,
} from "@/shared/domain/form-model";
import type { Languages, Locale } from "@/shared/domain/localized-text";
import { stagedBytes, withFileAnswers, type StagedUpload } from "./in-progress";

/** The fields that take files, in document order, read from the type hook (ADR 0016). */
export function uploadFields(
  version: Version,
  registry: FieldTypeRegistry,
): { field: Field; limits: UploadLimits }[] {
  const found: { field: Field; limits: UploadLimits }[] = [];
  for (const page of version.pages)
    for (const field of page.fields) {
      const def = registry.get(field.type);
      if (def.uploadLimits) found.push({ field, limits: def.uploadLimits(field.settings) });
    }
  return found;
}

/** English unless the form is Spanish only: the field slug language of the media keys (`specs/system/media-storage.md`, "The `MediaStorage` port"). */
export function firstLanguage(languages: Languages): Locale {
  return languages === "es" ? "es" : "en";
}

/**
 * The staged bytes of the upload fields the answers show. A hidden field's
 * files have no Remove on any page and are discarded at Submit, so they never
 * count toward the per-submission size.
 */
export function visibleStagedBytes(
  version: Version,
  registry: FieldTypeRegistry,
  answers: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, readonly StagedUpload[]>>,
): number {
  const visible = evaluateVisibility(version, withFileAnswers(answers, files), registry).fields;
  return stagedBytes(
    Object.fromEntries(Object.entries(files).filter(([key]) => visible.get(key) === true)),
  );
}

export interface PlannedFile {
  fieldKey: string;
  /** 1-based, in answer order. */
  position: number;
  upload: StagedUpload;
}

/**
 * Per field, the staged files the final answers name, in answer order; every
 * other staged file, including those of fields the answers no longer hold, is
 * discarded.
 */
export function planFiles(
  answers: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, readonly StagedUpload[]>>,
): { attached: PlannedFile[]; discarded: StagedUpload[] } {
  const attached: PlannedFile[] = [];
  const discarded: StagedUpload[] = [];
  for (const [fieldKey, uploads] of Object.entries(files)) {
    const answer = answers[fieldKey];
    const named = Array.isArray(answer) ? answer.filter((a) => typeof a === "string") : [];
    const byId = new Map(uploads.map((u) => [u.id, u]));
    const used = new Set<string>();
    for (const id of named) {
      const upload = byId.get(id);
      if (!upload || used.has(id)) continue;
      used.add(id);
      attached.push({ fieldKey, position: used.size, upload });
    }
    for (const u of uploads) if (!used.has(u.id)) discarded.push(u);
  }
  return { attached, discarded };
}

/** The non-empty answer of the field holding the `submitter_address` role, else null. */
export function submitterAddress(
  version: Version,
  registry: FieldTypeRegistry,
  answers: Readonly<Record<string, unknown>>,
): string | null {
  for (const page of version.pages)
    for (const field of page.fields) {
      const roles = registry.get(field.type).exclusiveRoles?.(field.settings) ?? [];
      if (!roles.some((r) => r.role === "submitter_address")) continue;
      const answer = answers[field.key];
      return typeof answer === "string" && answer.trim() !== "" ? answer : null;
    }
  return null;
}

/** The first page, in document order, holding a field an issue names. */
export function firstPageWithIssue(
  version: Version,
  issues: readonly ValidationIssue[],
): string | null {
  const named = new Set<string>(issues.map((i) => i.field));
  return version.pages.find((p) => p.fields.some((f) => named.has(f.key)))?.key ?? null;
}
