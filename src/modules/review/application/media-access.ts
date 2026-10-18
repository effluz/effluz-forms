import type { Actor } from "@/modules/definitions/application";
import type { AuditEntry } from "@/modules/identity/application";
import {
  findMedia,
  listSubmissionMedia,
  mediaThumbnail,
  openMedia,
  videoViewUrl,
  type MediaRecord,
} from "@/modules/media/application";
import { STAFF_PHOTOS_FIELD_KEY } from "../domain/staff-photos";
import { loadStory } from "./context";
import type { ReviewDeps } from "./deps";
import { storyFiles, type StoryFile } from "./open-story";
import type { ZipEntry } from "./ports/zip-writer";

export type MediaView = "thumb" | "full" | "download";

export type MediaAccess =
  | { kind: "bytes"; contentType: "image/webp"; body: Uint8Array }
  | {
      kind: "stream";
      contentType: string;
      size: number;
      filename: string;
      body: ReadableStream<Uint8Array>;
    }
  | { kind: "redirect"; url: string };

export type PhotoArchiveResult =
  | { ok: true; filename: string; body: ReadableStream<Uint8Array> }
  | { ok: false; code: "not_found" | "none" };

/** The last segment of a durable key: `01-photos.jpg`, never anything the sender wrote. */
function fileName(record: MediaRecord): string {
  return record.durableKey.slice(record.durableKey.lastIndexOf("/") + 1);
}

/** Records one entry in its own unit of work. */
function recordAccess(deps: ReviewDeps, entry: AuditEntry): Promise<void> {
  return deps.uow.run((uow) => deps.audit.record(uow, entry, deps.clock.now()));
}

/** Opens the file, then records the entry; a failed record cancels the opened stream. */
async function auditedStream(
  deps: ReviewDeps,
  record: MediaRecord,
  entry: AuditEntry,
): Promise<MediaAccess | null> {
  const body = await openMedia(deps.media, record);
  if (body === null) return null;
  try {
    await recordAccess(deps, entry);
  } catch (error) {
    await body.cancel().catch(() => undefined);
    throw error;
  }
  return {
    kind: "stream",
    contentType: record.contentType,
    size: record.size,
    filename: fileName(record),
    body,
  };
}

/** The media row when it is a live file of this submission; a staff row without its staff_photo row is being deleted. */
async function storyMedia(
  deps: ReviewDeps,
  submissionId: string,
  mediaId: string,
): Promise<MediaRecord | null> {
  const record = await findMedia(deps.media, mediaId);
  if (record?.submissionId !== submissionId) return null;
  if (record.fieldKey !== STAFF_PHOTOS_FIELD_KEY) return record;
  const staff = await deps.staffPhotos.listBySubmission(submissionId);
  return staff.some((row) => row.id === record.id) ? record : null;
}

/**
 * One file of a story (specs/use-cases/review-submissions.md, "view one", step 3).
 * Null when the story or the file is not there. `full` records photo_viewed,
 * `download` media_downloaded; `thumb` records nothing. A full view of a stored
 * video redirects to the provider's temporary link instead of streaming it.
 */
export async function accessMedia(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string; mediaId: string; view: MediaView },
): Promise<MediaAccess | null> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return null;
  const id = found.submission.id;
  const record = await storyMedia(deps, id, input.mediaId);
  if (!record) return null;
  const base = { actorEmail: actor.email, targetId: id, ip: actor.ip };

  if (input.view === "thumb") {
    const body = await mediaThumbnail(deps.media, record);
    return body === null ? null : { kind: "bytes", contentType: "image/webp", body };
  }
  if (input.view === "download")
    return auditedStream(deps, record, {
      ...base,
      action: "media_downloaded",
      details: { mediaId: record.id },
    });
  const viewed: AuditEntry = {
    ...base,
    action: "photo_viewed",
    details: { mediaId: record.id, kind: record.kind },
  };
  const url = await videoViewUrl(deps.media, record);
  if (url === null) return auditedStream(deps, record, viewed);
  await recordAccess(deps, viewed);
  return { kind: "redirect", url };
}

async function* zipEntries(
  deps: ReviewDeps,
  reference: string,
  files: readonly StoryFile[],
): AsyncIterable<ZipEntry> {
  for (const { record } of files)
    yield await Promise.resolve({
      name: `${reference}/${fileName(record)}`,
      modifiedAt: record.createdAt,
      open: () => openMedia(deps.media, record),
    });
}

/**
 * The story's files as one ZIP (specs/system/media-storage.md, "Downloads"): every
 * file, or the chosen photos only. `none` when the set is empty. One
 * media_downloaded entry with the set and the count, recorded before streaming.
 */
export async function photoArchive(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string; set: "all" | "chosen" },
): Promise<PhotoArchiveResult> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return { ok: false, code: "not_found" };
  const id = found.submission.id;
  const [media, staffRows, story] = await Promise.all([
    listSubmissionMedia(deps.media, id),
    deps.staffPhotos.listBySubmission(id),
    deps.stories.find(id),
  ]);
  const all = storyFiles(found.version, media, staffRows);
  const chosen = new Set(story?.chosen ?? []);
  const files = input.set === "all" ? all : all.filter((f) => chosen.has(f.record.id));
  if (files.length === 0) return { ok: false, code: "none" };

  await recordAccess(deps, {
    action: "media_downloaded",
    actorEmail: actor.email,
    targetId: id,
    ip: actor.ip,
    details: { set: input.set, count: files.length },
  });
  const { reference } = found.submission;
  const suffix = input.set === "chosen" ? "-chosen" : "";
  return {
    ok: true,
    filename: `${found.ctx.form.slug}-${reference}${suffix}.zip`,
    body: deps.zip.write(zipEntries(deps, reference, files)),
  };
}
