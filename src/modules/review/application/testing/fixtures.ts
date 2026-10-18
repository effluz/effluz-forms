/**
 * Synthetic stories for review use-case tests.
 *
 * - `OWNER`: the acting staff member.
 * - `seedStory(deps, over?)`: `storyVersion()` with consent item 10 covered
 *   (unless `laterPhotos: false`), published as `story-form` (prefix `ST`,
 *   post plan on unless `postPlan: false`), and one stored story ST-0001,
 *   received `2026-10-16T14:00:00Z` in Spanish, with two image rows of the
 *   `f_photos` answer: `01-photos.jpg` (p1, staged, its bytes in staging) and
 *   `02-photos.jpg` (p2, stored, its bytes in durable storage). `status` sets
 *   its curation status; `nameMaxLength` adds a `max_length` rule to `f_name`.
 * - `seedAnotherStory(deps, formId)`: ST-0002 on the form's current version,
 *   received a day later, without files.
 *
 * Synthetic data only. Not for production code.
 */
import type { Actor } from "@/modules/definitions/application";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { publishStory } from "@/modules/submissions/application/testing/fakes";
import { consentTextVersion, type Field, type Version } from "@/shared/domain/form-model";
import { localizedTextSchema } from "@/shared/domain/localized-text";
import type { ReviewStatus } from "../../domain/status";
import type { FakeReviewDeps } from "./fakes";

export const OWNER: Actor = { email: "owner@example.com", ip: "203.0.113.9" };

const FIRST_RECEIVED = new Date("2026-10-16T14:00:00Z");
const SECOND_RECEIVED = new Date("2026-10-17T14:00:00Z");

function mapFields(version: Version, change: (field: Field) => Field): Version {
  return {
    ...version,
    pages: version.pages.map((page) => ({ ...page, fields: page.fields.map(change) })),
  };
}

function withLaterPhotos(field: Field): Field {
  if (field.type !== "consent") return field;
  const settings = field.settings as { coveredItems: string[] };
  return {
    ...field,
    settings: { ...settings, coveredItems: [...settings.coveredItems, "later_photos"] },
  };
}

function currentVersion(deps: FakeReviewDeps, formId: string) {
  const versionId = deps.definitions.store.forms.get(formId)?.currentVersionId;
  const version = versionId == null ? undefined : deps.definitions.store.versions.get(versionId);
  if (!version) throw new Error(`fixture: form ${formId} has no current version`);
  return version;
}

function consentAnswer(version: Version): { accepted: true; textVersion: string } {
  for (const page of version.pages)
    for (const field of page.fields) {
      if (field.type !== "consent") continue;
      const text = localizedTextSchema.parse((field.settings as { text: unknown }).text);
      return { accepted: true, textVersion: consentTextVersion(text) };
    }
  throw new Error("fixture: the version has no consent field");
}

function storeSubmission(
  deps: FakeReviewDeps,
  input: {
    formId: string;
    reference: string;
    receivedAt: Date;
    answers: Record<string, unknown>;
    id?: string;
  },
): string {
  const version = currentVersion(deps, input.formId);
  const id = input.id ?? deps.ids.newId();
  const consent = consentAnswer(version.document);
  deps.submissions.submissions.rows.set(id, {
    id,
    formId: input.formId,
    versionId: version.id,
    locale: "es",
    answers: { ...input.answers, f_consent: consent },
    consent: {
      fieldKey: "f_consent",
      textVersion: consent.textVersion,
      acceptedAt: input.receivedAt,
    },
    receivedAt: input.receivedAt,
    reference: input.reference,
    submitToken: deps.ids.newId(),
  });
  return id;
}

export async function seedStory(
  deps: FakeReviewDeps,
  over: {
    postPlan?: boolean;
    laterPhotos?: boolean;
    status?: ReviewStatus;
    /** Adds a `max_length` rule of this value to `f_name`. */
    nameMaxLength?: number;
  } = {},
): Promise<{
  formId: string;
  submissionId: string;
  reference: "ST-0001";
  photoIds: [string, string];
}> {
  const { formId, versionId } = await publishStory(deps.submissions, {
    usePostPlan: over.postPlan ?? true,
  });
  const stored = currentVersion(deps, formId);
  let document = stored.document;
  if (over.laterPhotos !== false) document = mapFields(document, withLaterPhotos);
  const nameMax = over.nameMaxLength;
  if (nameMax !== undefined)
    document = mapFields(document, (f) =>
      f.key === "f_name"
        ? { ...f, validation: [...f.validation, { rule: "max_length", value: nameMax }] }
        : f,
    );
  deps.definitions.store.versions.set(versionId, { ...stored, document });

  const submissionId = deps.ids.newId();
  const p1 = deps.ids.newId();
  const p2 = deps.ids.newId();
  storeSubmission(deps, {
    id: submissionId,
    formId,
    reference: "ST-0001",
    receivedAt: FIRST_RECEIVED,
    answers: {
      f_name: "Ana Prueba",
      f_email: "ana@example.com",
      f_baby: "yes_opt",
      f_photos: [p1, p2],
    },
  });
  const base = {
    submissionId,
    formId,
    fieldKey: "f_photos",
    kind: "image" as const,
    contentType: "image/jpeg",
    size: 64,
    providerRef: null,
    createdAt: FIRST_RECEIVED,
    updatedAt: FIRST_RECEIVED,
  };
  const stagingRef = `in-progress/${deps.ids.newId()}/${p1}.jpg`;
  deps.media.media.rows.set(p1, {
    ...base,
    id: p1,
    position: 1,
    status: "staged",
    stagingRef,
    durableKey: "forms/story-form/ST-0001/01-photos.jpg",
  });
  deps.media.media.rows.set(p2, {
    ...base,
    id: p2,
    position: 2,
    status: "stored",
    stagingRef: null,
    durableKey: "forms/story-form/ST-0001/02-photos.jpg",
  });
  await deps.media.staging.put(fakeImage(), stagingRef, "image/jpeg");
  await deps.media.durable.put(fakeImage(), "forms/story-form/ST-0001/02-photos.jpg", "image/jpeg");

  if (over.status !== undefined && over.status !== "new")
    deps.submissions.submissions.curation.set(submissionId, {
      status: over.status,
      curatedAnswers: {},
      publishedPostUrl: null,
      statusChangedBy: null,
      statusChangedAt: null,
    });
  return { formId, submissionId, reference: "ST-0001", photoIds: [p1, p2] };
}

export function seedAnotherStory(
  deps: FakeReviewDeps,
  formId: string,
): Promise<{ submissionId: string; reference: "ST-0002" }> {
  const submissionId = storeSubmission(deps, {
    formId,
    reference: "ST-0002",
    receivedAt: SECOND_RECEIVED,
    answers: { f_name: "Bea Prueba", f_email: "bea@example.com", f_baby: "no_opt" },
  });
  return Promise.resolve({ submissionId, reference: "ST-0002" });
}
