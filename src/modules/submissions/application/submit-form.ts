import { allocateReference } from "@/modules/definitions/application";
import {
  attachToSubmission,
  durableKey,
  extensionFor,
  uniqueFieldSlugs,
  type AttachedFile,
} from "@/modules/media/application";
import { enqueueSubmissionEmails } from "@/modules/notifications/application";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { validateSubmission, type Version } from "@/shared/domain/form-model";
import { todayIn } from "../domain/dates";
import {
  clampStartedAt,
  isExpired,
  newInProgress,
  withFileAnswers,
  type InProgress,
  type RefusedFile,
} from "../domain/in-progress";
import {
  firstLanguage,
  firstPageWithIssue,
  planFiles,
  submitterAddress,
  uploadFields,
  type PlannedFile,
} from "../domain/intake";
import { pickLocale } from "../domain/locale";
import { firstPageKey, nextPageKey, pagePosition } from "../domain/navigation";
import { isSilentAccept } from "../domain/protection";
import type { Submission } from "../domain/submission";
import { pageInputKeys, pageRaw, pick } from "./answers";
import type { SubmissionsDeps } from "./deps";
import type { PagePost, PostOutcome } from "./fill-state";
import type { OpenContext } from "./post-context";
import { checkPostedPage } from "./posted-page";
import { discardAfterSilentAccept, silentAccept } from "./silent-accept";
import { discardQuietly, mergeBatch, refusedOf, stageIncoming, type StagedBatch } from "./staging";

/**
 * Thrown inside the unit of work when the insert meets the submit token (a
 * race the pre-check lost), so the whole intake rolls back and gives its
 * reference number back.
 */
class DuplicateSubmit extends Error {
  constructor(readonly submitToken: string) {
    super("duplicate submit");
  }
}

interface Taken {
  outcome: PostOutcome;
  /** Staging references to delete once the unit of work has committed. */
  discard: string[];
  /** Set by a silent accept: the record whose staging prefix goes after commit. */
  decoyOf?: string;
  /** Set when a submission was stored. */
  submissionId?: string;
}

const submitted = (submitToken: string): PostOutcome => ({ kind: "submitted", submitToken });

async function isSubmitted(
  deps: SubmissionsDeps,
  uow: UnitOfWork,
  formId: string,
  submitToken: string,
): Promise<boolean> {
  const found = await deps.submissions.findBySubmitToken(submitToken, uow);
  return found?.formId === formId;
}

/** Field slugs of the media keys, over the upload fields in field order, in the form's first language. */
function fieldSlugs(version: Version, deps: SubmissionsDeps): Map<string, string> {
  const locale = firstLanguage(version.languages);
  return uniqueFieldSlugs(
    uploadFields(version, deps.registry).map(({ field }) => ({
      fieldKey: field.key,
      label: field.label[locale] ?? "",
    })),
  );
}

function attachedFiles(
  planned: readonly PlannedFile[],
  input: { formSlug: string; reference: string; slugs: Map<string, string> },
): AttachedFile[] {
  return planned.map(({ fieldKey, position, upload }) => ({
    fieldKey,
    position,
    durableKey: durableKey({
      formSlug: input.formSlug,
      reference: input.reference,
      position,
      fieldSlug: input.slugs.get(fieldKey) ?? "file",
      ext: extensionFor(upload.contentType),
    }),
    file: upload,
  }));
}

/**
 * Submit: the intake transaction of specs/architecture.md, "Submission data
 * flow" step 3, with the alternate flows of
 * specs/use-cases/fill-and-submit-form.md. One unit of work locks the
 * in-progress row first and the form row second (specs/system/database.md).
 * Nothing external is called inside it: the jobs do that after commit.
 */
export async function submitForm(
  deps: SubmissionsDeps,
  context: OpenContext,
  post: PagePost,
): Promise<PostOutcome> {
  const { record: existing } = context;
  const doc = context.version.document;
  if (!doc.pages.some((p) => p.key === post.pageKey)) return { kind: "expired" };
  // A one-page form is submitted from page 1 before any record exists: page 1 must also be
  // the last visible page, so a crafted Submit cannot skip the pages after it.
  if (!existing) {
    const onPage = pick(post.answers, pageInputKeys(doc, deps.registry, post.pageKey).answers);
    if (
      post.pageKey !== firstPageKey(doc, deps.registry) ||
      nextPageKey(doc, onPage, deps.registry, post.pageKey) !== null
    )
      return { kind: "expired" };
  }

  const recordId = existing?.id ?? deps.ids.newId();
  const batch = await stageIncoming(deps, {
    recordId,
    version: doc,
    pageKey: post.pageKey,
    answers: existing?.answers ?? {},
    existing: existing?.files ?? {},
    incoming: post.incoming,
  });

  let taken: Taken;
  try {
    taken = await deps.uow.run((uow) => intake(deps, uow, { context, post, recordId, batch }));
  } catch (error) {
    await discardQuietly(deps, batch.refs);
    if (error instanceof DuplicateSubmit) return submitted(error.submitToken);
    throw error;
  }

  if (taken.decoyOf !== undefined)
    await discardAfterSilentAccept(deps, { recordId: taken.decoyOf, refs: taken.discard });
  else await discardQuietly(deps, taken.discard);
  if (taken.submissionId !== undefined)
    deps.logger.info("submission received", {
      formId: context.form.id,
      submissionId: taken.submissionId,
    });
  return taken.outcome;
}

async function intake(
  deps: SubmissionsDeps,
  uow: UnitOfWork,
  input: { context: OpenContext; post: PagePost; recordId: string; batch: StagedBatch },
): Promise<Taken> {
  const { context, post, recordId, batch } = input;
  const { form, version: pinned, record: existing } = context;
  const doc = pinned.document;
  const now = deps.clock.now();
  const nothing = (outcome: PostOutcome): Taken => ({ outcome, discard: batch.refs });

  let locked: InProgress | null = null;
  if (existing) {
    locked = await deps.inProgress.findForUpdate(uow, existing.id);
    // A double click: the first Submit committed and deleted the row.
    if (!locked)
      return nothing(
        (await isSubmitted(deps, uow, form.id, existing.submitToken))
          ? submitted(existing.submitToken)
          : { kind: "expired" },
      );
    if (isExpired(locked, now)) return nothing({ kind: "expired" });
  }

  const startedAt = locked?.startedAt ?? clampStartedAt(post.renderedAt, now);
  if (isSilentAccept({ honeypot: post.honeypot, startedAt, now })) {
    const outcome = await silentAccept(deps, uow, { form, recordId, locked: locked !== null });
    return { outcome, discard: batch.refs, decoyOf: recordId };
  }

  let record: InProgress =
    locked ??
    newInProgress({
      id: recordId,
      formId: form.id,
      versionId: pinned.id,
      locale: pickLocale(doc.languages, post.acceptLanguage),
      pageKey: post.pageKey,
      submitToken: deps.ids.newId(),
      startedAt,
      now,
    });
  const save = (r: InProgress) =>
    locked ? deps.inProgress.update(uow, r) : deps.inProgress.insert(uow, r);
  const refused = (r: InProgress, refusedFiles: RefusedFile[]): PostOutcome => ({
    kind: "refused",
    recordId: r.id,
    locale: r.locale,
    page: pagePosition(doc, withFileAnswers(r.answers, r.files), deps.registry, r.pageKey).n,
    refusedFiles,
  });

  // The last page, as on Next.
  const merged = mergeBatch(record, batch, doc, deps.registry);
  record = merged.record;
  const refusedFiles = refusedOf(batch, merged.oversize);
  const today = todayIn(form.settings.timezone, now);
  const checked = checkPostedPage(deps.registry, {
    version: doc,
    record,
    post,
    today,
    enforceRequired: true,
    countIssues: merged.issues,
  });
  record = { ...record, answers: checked.answers, updatedAt: now };
  const raw = pageRaw(post.raw, pageInputKeys(doc, deps.registry, post.pageKey).answers);
  if (checked.issues.length > 0 || refusedFiles.length > 0) {
    record = {
      ...record,
      pageKey: post.pageKey,
      pending: { pageKey: post.pageKey, raw, issues: checked.issues },
    };
    await save(record);
    return { outcome: refused(record, refusedFiles), discard: merged.overflow };
  }

  // The whole submission; answers to hidden fields are dropped here.
  const full = validateSubmission(
    doc,
    deps.registry,
    withFileAnswers(record.answers, record.files),
    { today },
  );
  if (!full.ok) {
    const pageKey = firstPageWithIssue(doc, full.issues) ?? post.pageKey;
    const onPage = new Set<string>(
      doc.pages.find((p) => p.key === pageKey)?.fields.map((f) => f.key) ?? [],
    );
    record = {
      ...record,
      pageKey,
      pending: {
        pageKey,
        raw: pageKey === post.pageKey ? raw : {},
        issues: full.issues.filter((i) => onPage.has(i.field)),
      },
    };
    await save(record);
    return { outcome: refused(record, []), discard: merged.overflow };
  }

  // A token already used answers before any reference is taken, so a duplicate commits nothing.
  if (locked && (await isSubmitted(deps, uow, form.id, record.submitToken)))
    return nothing(submitted(record.submitToken));

  const allocated = await allocateReference(deps.definitions, uow, form.id);
  if (!allocated.ok) return nothing({ kind: "gate", state: allocated.state });

  const submission: Submission = {
    id: deps.ids.newId(),
    formId: form.id,
    versionId: record.versionId,
    locale: record.locale,
    answers: full.answers,
    consent: full.consent
      ? { fieldKey: full.consent.fieldKey, textVersion: full.consent.textVersion, acceptedAt: now }
      : null,
    receivedAt: now,
    reference: allocated.reference,
    submitToken: record.submitToken,
  };
  if ((await deps.submissions.insert(uow, submission)) === "duplicate_token")
    throw new DuplicateSubmit(record.submitToken);

  const plan = planFiles(full.answers, record.files);
  await attachToSubmission({ media: deps.media.media, queue: deps.queue, clock: deps.clock }, uow, {
    submissionId: submission.id,
    formId: form.id,
    files: attachedFiles(plan.attached, {
      formSlug: allocated.form.slug,
      reference: allocated.reference,
      slugs: fieldSlugs(doc, deps),
    }),
  });
  const { settings } = allocated.form;
  await enqueueSubmissionEmails(deps.queue, uow, {
    submissionId: submission.id,
    submitterConfirmation:
      doc.confirmation.email !== undefined &&
      submitterAddress(doc, deps.registry, full.answers) !== null,
    staffNotification:
      settings.notificationCadence === "per_submission" &&
      settings.notificationRecipients.length > 0,
  });
  if (locked) await deps.inProgress.delete(uow, record.id);

  return {
    outcome: submitted(record.submitToken),
    discard: [...merged.overflow, ...plan.discarded.map((u) => u.stagingRef)],
    submissionId: submission.id,
  };
}
