import type { Actor, FormVersion } from "@/modules/definitions/application";
import type { AuditRecord } from "@/modules/identity/application";
import {
  listSubmissionMedia,
  type MediaKind,
  type MediaRecord,
  type MediaStatus,
} from "@/modules/media/application";
import {
  lockSubmission,
  writeCuration,
  type StoredSubmission,
} from "@/modules/submissions/application";
import {
  consentTextVersion,
  fieldIndex,
  type Field,
  type FieldTypeRegistry,
} from "@/shared/domain/form-model";
import {
  localizedTextSchema,
  type Languages,
  type Locale,
  type LocalizedText,
} from "@/shared/domain/localized-text";
import type { IsoDate } from "../domain/days";
import type { ListQuery } from "../domain/list-query";
import { editedStale, readiness, type Readiness, type StoryChecks } from "../domain/readiness";
import { STAFF_PHOTOS_FIELD_KEY, type StaffPhotoSource } from "../domain/staff-photos";
import { statusAfterOpen, type ReviewStatus } from "../domain/status";
import { listFilterFor, loadStory, type FormContext } from "./context";
import { withDeadlockRetry } from "./deadlock";
import type { ReviewDeps } from "./deps";
import type { EditRow } from "./ports/edit-repository";
import type { StaffPhotoRow } from "./ports/staff-photo-repository";
import { emptyStory } from "./ports/story-repository";

const ACTIVITY_LIMIT = 50;

export interface AnswerView {
  field: Field;
  languages: Languages;
  /** Undefined when not answered. */
  answer: unknown;
  corrected: { text: string; by: string | null; at: Date | null } | null;
  curatable: boolean;
  /** The field's own `max_length` rule, else the type's cap. */
  maxLength: number | null;
}

export interface AnswerPageView {
  key: string;
  title: LocalizedText;
  answers: AnswerView[];
}

export interface PhotoView {
  mediaId: string;
  kind: MediaKind;
  status: MediaStatus;
  durableKey: string;
  chosen: boolean;
  origin: "sender" | "staff";
  staff: { addedBy: string; addedAt: Date; source: StaffPhotoSource } | null;
}

export interface StoryView {
  ctx: FormContext;
  submissionId: string;
  reference: string;
  receivedAt: Date;
  versionNumber: number;
  locale: Locale;
  status: ReviewStatus;
  postUrl: string | null;
  plannedOn: IsoDate | null;
  publishedOn: IsoDate | null;
  pages: AnswerPageView[];
  photos: PhotoView[];
  checks: StoryChecks;
  readiness: Readiness;
  editedStale: boolean;
  photosEditedBy: { by: string; at: Date } | null;
  textCheckedBy: { by: string; at: Date } | null;
  consent: { textVersion: string; acceptedAt: Date; text: LocalizedText | null } | null;
  deadJobs: { id: string; type: string }[];
  /** This submission's entries, newest 50. */
  activity: AuditRecord[];
  neighbours: { newer: string | null; older: string | null };
}

/** The field's own `max_length` rule, else the type's cap, else null. */
export function maxLengthOf(field: Field, registry: FieldTypeRegistry): number | null {
  for (const rule of field.validation) if (rule.rule === "max_length") return rule.value;
  return registry.get(field.type).maxLength ?? null;
}

function answerPages(
  version: FormVersion,
  submission: StoredSubmission,
  edits: Map<string, EditRow>,
  registry: FieldTypeRegistry,
): AnswerPageView[] {
  const { languages } = version.document;
  const curated = submission.curation.curatedAnswers;
  return version.document.pages
    .map((page) => ({
      key: page.key,
      title: page.title,
      answers: page.fields
        .filter((field) => registry.get(field.type).isInput)
        .map((field): AnswerView => {
          const answer = submission.answers[field.key];
          const text = curated[field.key];
          const edit = edits.get(field.key);
          return {
            field,
            languages,
            answer,
            corrected:
              text === undefined
                ? null
                : { text, by: edit?.editor ?? null, at: edit?.createdAt ?? null },
            curatable:
              registry.get(field.type).reviewTraits?.curatable === true &&
              typeof answer === "string",
            maxLength: maxLengthOf(field, registry),
          };
        }),
    }))
    .filter((page) => page.answers.length > 0);
}

function photoViews(
  version: FormVersion,
  media: readonly MediaRecord[],
  staffRows: readonly StaffPhotoRow[],
  chosen: readonly string[],
): PhotoView[] {
  const order = fieldIndex(version.document);
  const fieldOrder = (key: string) => order.get(key)?.order ?? Number.MAX_SAFE_INTEGER;
  const view = (m: MediaRecord, staff: StaffPhotoRow | null): PhotoView => ({
    mediaId: m.id,
    kind: m.kind,
    status: m.status,
    durableKey: m.durableKey,
    chosen: chosen.includes(m.id),
    origin: staff === null ? "sender" : "staff",
    staff:
      staff === null
        ? null
        : { addedBy: staff.addedBy, addedAt: staff.createdAt, source: staff.source },
  });
  const sender = media
    .filter((m) => m.fieldKey !== STAFF_PHOTOS_FIELD_KEY)
    .sort((a, b) => fieldOrder(a.fieldKey) - fieldOrder(b.fieldKey) || a.position - b.position)
    .map((m) => view(m, null));
  // A staff media row without its staff_photo row is being deleted: hide it.
  const staffById = new Map(staffRows.map((row) => [row.id, row]));
  const staff = media
    .flatMap((m) => {
      const row = m.fieldKey === STAFF_PHOTOS_FIELD_KEY ? staffById.get(m.id) : undefined;
      return row === undefined ? [] : [{ m, row }];
    })
    .sort(
      (a, b) =>
        a.row.createdAt.getTime() - b.row.createdAt.getTime() || a.m.position - b.m.position,
    )
    .map(({ m, row }) => view(m, row));
  return [...sender, ...staff];
}

function consentView(version: FormVersion, submission: StoredSubmission): StoryView["consent"] {
  const consent = submission.consent;
  if (consent === null) return null;
  const field = fieldIndex(version.document).get(consent.fieldKey)?.field;
  const settings = field?.settings;
  const parsed = localizedTextSchema.safeParse(
    settings !== null && typeof settings === "object" && "text" in settings
      ? settings.text
      : undefined,
  );
  const text =
    parsed.success && consentTextVersion(parsed.data) === consent.textVersion ? parsed.data : null;
  return { textVersion: consent.textVersion, acceptedAt: consent.acceptedAt, text };
}

const byAndAt = (by: string | null, at: Date | null) =>
  by !== null && at !== null ? { by, at } : null;

/**
 * The story page. Opening a `new` story makes it `viewed`; every open is one
 * `submission_viewed` entry (specs/use-cases/review-submissions.md, "view one").
 */
export async function openStory(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string; query: ListQuery },
): Promise<StoryView | null> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return null;
  const { ctx, version } = found;
  const id = found.submission.id;
  const submission = await withDeadlockRetry(() =>
    deps.uow.run(async (uow) => {
      const locked = await lockSubmission(deps.submissions, uow, id);
      if (!locked) return null;
      const now = deps.clock.now();
      const status = statusAfterOpen(locked.curation.status);
      const curation =
        status === locked.curation.status
          ? locked.curation
          : { ...locked.curation, status, statusChangedBy: actor.email, statusChangedAt: now };
      if (curation !== locked.curation) await writeCuration(deps.submissions, uow, id, curation);
      await deps.audit.record(
        uow,
        { action: "submission_viewed", actorEmail: actor.email, targetId: id, ip: actor.ip },
        now,
      );
      return { ...locked, curation };
    }),
  );
  if (!submission) return null;

  const media = await listSubmissionMedia(deps.media, id);
  const [staffRows, storyRow, edits, dead, activity, neighbours] = await Promise.all([
    deps.staffPhotos.listBySubmission(id),
    deps.stories.find(id),
    deps.edits.latestByField(id),
    deps.jobs.deadFor({ submissionId: id, mediaIds: media.map((m) => m.id) }),
    deps.auditReader.listByTarget({ targetId: id, limit: ACTIVITY_LIMIT }),
    deps.queries.neighbours(listFilterFor(ctx, input.query, deps.registry), {
      receivedAt: submission.receivedAt,
      submissionId: id,
    }),
  ]);
  const story = storyRow ?? emptyStory(id, ctx.form.id);
  const checks: StoryChecks = {
    chosen: story.chosen,
    photosEditedFor: story.photosEditedFor,
    textCheckedAt: story.textCheckedAt,
  };
  return {
    ctx,
    submissionId: id,
    reference: submission.reference,
    receivedAt: submission.receivedAt,
    versionNumber: version.number,
    locale: submission.locale,
    status: submission.curation.status,
    postUrl: submission.curation.publishedPostUrl,
    plannedOn: story.plannedOn,
    publishedOn: story.publishedOn,
    pages: answerPages(version, submission, edits, deps.registry),
    photos: photoViews(version, media, staffRows, story.chosen),
    checks,
    readiness: readiness(checks),
    editedStale: editedStale(checks),
    photosEditedBy: byAndAt(story.photosEditedBy, story.photosEditedAt),
    textCheckedBy: byAndAt(story.textCheckedBy, story.textCheckedAt),
    consent: consentView(version, submission),
    deadJobs: dead.map((job) => ({ id: job.id, type: job.type })),
    activity,
    neighbours,
  };
}
