import {
  laterPhotosCovered,
  listVersions,
  loadForm,
  type Form,
  type FormVersion,
} from "@/modules/definitions/application";
import {
  findSubmissionByReference,
  type StoredSubmission,
} from "@/modules/submissions/application";
import { inputFields, type FieldTypeRegistry, type Version } from "@/shared/domain/form-model";
import type { ListQuery } from "../domain/list-query";
import type { ReviewDeps } from "./deps";
import type { ListFilter } from "./ports/review-queries";

/** A version id no version has, so the filter matches nothing. */
const NO_VERSION = "none";

/** A form as review sees it: every version, and whether the post plan applies. */
export interface FormContext {
  form: Form;
  /** Oldest first. */
  versions: FormVersion[];
  /** "Use submissions in the post plan" is on. */
  postPlan: boolean;
  /** Staff photos are enabled: the post plan is on and the current version covers `later_photos`. */
  laterPhotosAllowed: boolean;
}

export async function loadFormContext(
  deps: ReviewDeps,
  formId: string,
): Promise<FormContext | null> {
  const form = await loadForm(deps.definitions, formId);
  if (!form) return null;
  const versions = await listVersions(deps.definitions, form.id);
  const postPlan = form.settings.usePostPlan;
  const laterPhotosAllowed = postPlan && (await laterPhotosCovered(deps.definitions, form));
  return { form, versions, postPlan, laterPhotosAllowed };
}

/** A stored submission of the form together with the version it answered. */
export interface StoryContext {
  ctx: FormContext;
  submission: StoredSubmission;
  version: FormVersion;
}

/** Null when the form, the reference within that form or the pinned version is unknown. */
export async function loadStory(
  deps: ReviewDeps,
  formId: string,
  reference: string,
): Promise<StoryContext | null> {
  const ctx = await loadFormContext(deps, formId);
  if (!ctx) return null;
  const submission = await findSubmissionByReference(deps.submissions, ctx.form.id, reference);
  if (submission?.formId !== ctx.form.id) return null;
  const version = ctx.versions.find((v) => v.id === submission.versionId);
  if (!version) return null;
  return { ctx, submission, version };
}

/** Answer keys of every version's `searchable` fields, in first-seen order. */
function searchKeys(versions: readonly FormVersion[], registry: FieldTypeRegistry): string[] {
  const keys = new Set<string>();
  for (const version of versions)
    for (const field of inputFields(version.document, registry))
      if (registry.get(field.type).reviewTraits?.searchable === true) keys.add(field.key);
  return [...keys];
}

/** The query as a filter for this form: version number to id, the plan filter only on post-plan forms, search keys from every version's `searchable` fields. */
export function listFilterFor(
  ctx: FormContext,
  query: ListQuery,
  registry: FieldTypeRegistry,
): ListFilter {
  const versionId =
    query.version === null
      ? null
      : (ctx.versions.find((v) => v.number === query.version)?.id ?? NO_VERSION);
  return {
    formId: ctx.form.id,
    status: query.status,
    plan: ctx.postPlan ? query.plan : null,
    from: query.from,
    to: query.to,
    versionId,
    media: query.media,
    search: query.q === null ? null : { text: query.q, keys: searchKeys(ctx.versions, registry) },
  };
}

/** The first answer of a `label` field of the version, trimmed, or null. */
export function storyLabel(
  version: Version,
  registry: FieldTypeRegistry,
  answers: Record<string, unknown>,
): string | null {
  for (const field of inputFields(version, registry)) {
    if (registry.get(field.type).reviewTraits?.label !== true) continue;
    const answer = answers[field.key];
    if (typeof answer !== "string") continue;
    const label = answer.trim();
    if (label !== "") return label;
  }
  return null;
}
