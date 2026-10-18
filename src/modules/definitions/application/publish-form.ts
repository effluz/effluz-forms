import {
  parseDraft,
  validateForPublish,
  type PublishIssue,
  type Version,
} from "@/shared/domain/form-model";
import type { Languages } from "@/shared/domain/localized-text";
import { countFields, diffVersions, sameDefinition, type VersionDiff } from "../domain/diff";
import type { Draft } from "../domain/draft";
import type { Form } from "../domain/form";
import { publicUrl, type Actor, type DefinitionsDeps } from "./deps";
import type { FormVersion } from "./ports/version-repository";

/** What the editor confirms before publishing. See specs/use-cases/publish-form.md, "Main flow: publish", step 3. */
export interface PublishPreview {
  nextNumber: number;
  /** The draft revision this preview checked; the publish carries it back. */
  draftRevision: number;
  pages: number;
  fields: number;
  languages: Languages;
  issues: PublishIssue[];
  unchanged: boolean;
  /** Null for a first publish. */
  diff: (VersionDiff & { removedAnswerCounts: Record<string, number> }) | null;
}

export type PublishResult =
  | { ok: true; versionId: string; number: number; publicUrl: string }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "archived" }
  | { ok: false; code: "issues"; issues: PublishIssue[] }
  | { ok: false; code: "unchanged" }
  | { ok: false; code: "conflict" };

export interface PublishFormInput {
  formId: string;
  /** The number the preview announced; anything else means someone published meanwhile. */
  expectedNumber: number;
  /** The draft revision the preview checked; anything else means a save landed meanwhile. */
  expectedRevision: number;
}

interface PublishState {
  form: Form;
  draft: Draft;
  current: FormVersion | null;
  latestNumber: number;
  issues: PublishIssue[];
}

/** A stored draft that fails the structural parse is a bug, never a publish issue. */
function assertStructurallyValid(deps: DefinitionsDeps, draft: Draft): void {
  const parsed = parseDraft(draft.document, deps.registry);
  if (!parsed.ok) throw new Error(`draft of form ${draft.formId} is structurally invalid`);
}

async function loadState(deps: DefinitionsDeps, formId: string): Promise<PublishState | null> {
  const [form, draft] = await Promise.all([deps.forms.findById(formId), deps.drafts.find(formId)]);
  if (!form || !draft) return null;
  assertStructurallyValid(deps, draft);
  const [current, latestNumber] = await Promise.all([
    deps.versions.findCurrent(form.id),
    deps.versions.latestNumber(form.id),
  ]);
  const issues = validateForPublish(draft.document, deps.registry, {
    retentionMonths: form.settings.retentionMonths,
    postPlan: form.settings.usePostPlan,
  });
  return { form, draft, current, latestNumber, issues };
}

function isUnchanged(current: FormVersion | null, document: Version): boolean {
  return current !== null && sameDefinition(current.document, document);
}

/**
 * The summary shown before publishing: next number, counts, languages, issues
 * and, for a republish, the diff with answer counts of removed fields. Null
 * when the form or its draft does not exist.
 * See specs/use-cases/publish-form.md, "Main flow: publish", steps 1 to 3.
 */
export async function publishPreview(
  deps: DefinitionsDeps,
  formId: string,
): Promise<PublishPreview | null> {
  const state = await loadState(deps, formId);
  if (!state) return null;
  const { form, draft, current, latestNumber, issues } = state;
  const document = draft.document;

  let diff: PublishPreview["diff"] = null;
  if (current) {
    const changes = diffVersions(current.document, document);
    const counts = await deps.stats.answerCounts(form.id, changes.removedKeys);
    const removedAnswerCounts: Record<string, number> = {};
    for (const key of changes.removedKeys) removedAnswerCounts[key] = counts.get(key) ?? 0;
    diff = { ...changes, removedAnswerCounts };
  }

  return {
    nextNumber: latestNumber + 1,
    draftRevision: draft.revision,
    ...countFields(document, deps.registry),
    languages: document.languages,
    issues,
    unchanged: isUnchanged(current, document),
    diff,
  };
}

/**
 * Publishes the draft as the next immutable version in one unit of work: the
 * version row, the form's current version and status, a fresh draft and the
 * `form_published` audit entry. The checks run on a plain read first; the unit
 * of work re-reads the form and draft with row locks and refuses when the
 * version or the draft revision moved since the preview.
 * See specs/use-cases/publish-form.md, "Main flow: publish", step 4, and
 * "Concurrent publish".
 */
export async function publishForm(
  deps: DefinitionsDeps,
  actor: Actor,
  input: PublishFormInput,
): Promise<PublishResult> {
  const state = await loadState(deps, input.formId);
  if (!state) return { ok: false, code: "not_found" };
  const { form, draft, current, latestNumber, issues } = state;
  // An archived form must be unarchived first; see specs/form-definition.md, "Lifecycle".
  if (form.status === "archived") return { ok: false, code: "archived" };
  // Checked next: a stale preview must reload whatever else is true of the draft.
  if (input.expectedNumber !== latestNumber + 1 || draft.revision !== input.expectedRevision) {
    return { ok: false, code: "conflict" };
  }
  if (issues.length > 0) return { ok: false, code: "issues", issues };
  if (isUnchanged(current, draft.document)) return { ok: false, code: "unchanged" };

  const now = deps.clock.now();
  const number = input.expectedNumber;
  const version: FormVersion = {
    id: deps.ids.newId(),
    formId: form.id,
    number,
    document: draft.document,
    publishedAt: now,
    publishedBy: actor.email,
  };

  return deps.uow.run(async (uow): Promise<PublishResult> => {
    // Form first, then draft: the lock order every use case follows.
    const fresh = await deps.forms.findForUpdate(uow, form.id);
    if (!fresh) return { ok: false, code: "not_found" };
    const freshDraft = await deps.drafts.findForUpdate(uow, form.id);
    if (!freshDraft) return { ok: false, code: "not_found" };
    if (fresh.status === "archived") return { ok: false, code: "archived" };
    // Another publish landed after our read, or an editor's save after the
    // preview: the previewed number or the checked document no longer holds.
    const versionMoved =
      fresh.currentVersionId !== form.currentVersionId ||
      fresh.currentVersionNumber !== form.currentVersionNumber;
    if (versionMoved || freshDraft.revision !== input.expectedRevision) {
      return { ok: false, code: "conflict" };
    }

    if ((await deps.versions.insert(uow, version)) === "number_taken") {
      return { ok: false, code: "conflict" };
    }
    const updated = await deps.forms.update(uow, {
      ...fresh,
      currentVersionId: version.id,
      currentVersionNumber: number,
      status: fresh.status === "draft" ? "published" : fresh.status,
      updatedAt: now,
    });
    // The slug is unchanged, so another owner would mean corrupt data.
    if (updated === "slug_taken") throw new Error(`form ${form.id} lost its slug`);
    const saved = await deps.drafts.save(
      uow,
      {
        ...freshDraft,
        document: structuredClone(freshDraft.document),
        updatedBy: actor.email,
        updatedAt: now,
      },
      freshDraft.revision,
    );
    // The row is locked, so a stale save is a bug; throwing undoes the version.
    if (saved === "stale") throw new Error(`draft of form ${form.id} changed while locked`);
    await deps.audit.record(
      uow,
      {
        action: "form_published",
        actorEmail: actor.email,
        targetId: form.id,
        ip: actor.ip,
        details: { number },
      },
      now,
    );
    return { ok: true, versionId: version.id, number, publicUrl: publicUrl(deps, fresh.slug) };
  });
}
