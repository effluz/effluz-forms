import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { MediaRecord } from "../domain/media";
import type { MediaDeps } from "./deps";

/** The longer side of a thumbnail, in pixels. See specs/system/media-storage.md, "Downloads". */
export const THUMBNAIL_MAX_SIDE = 320;

/** How long a provider view URL is asked to stay valid: Dropbox temporary links last four hours. */
export const VIEW_URL_TTL_SECONDS = 4 * 60 * 60;

export function findMedia(
  deps: Pick<MediaDeps, "media">,
  mediaId: string,
): Promise<MediaRecord | null> {
  return deps.media.findById(mediaId);
}

export function listSubmissionMedia(
  deps: Pick<MediaDeps, "media">,
  submissionId: string,
  uow?: UnitOfWork,
): Promise<MediaRecord[]> {
  return deps.media.listBySubmission(submissionId, uow);
}

/** The stream of a storage read, or null when the file is not there. */
async function tryOpen(
  open: () => Promise<ReadableStream<Uint8Array>>,
): Promise<ReadableStream<Uint8Array> | null> {
  try {
    return await open();
  } catch {
    // Never the error itself: a path or a provider answer is not for a log or a page.
    return null;
  }
}

/** The staging copy when it is still there, else the durable file once stored; null when neither exists. */
export async function openMedia(
  deps: MediaDeps,
  record: MediaRecord,
): Promise<ReadableStream<Uint8Array> | null> {
  const { stagingRef } = record;
  if (stagingRef !== null) {
    const staged = await tryOpen(() => deps.staging.openRead(stagingRef));
    if (staged !== null) return staged;
  }
  if (record.status !== "stored") return null;
  const ref = record.providerRef ?? deps.durable.refForKey(record.durableKey);
  return tryOpen(() => deps.durable.openRead(ref));
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A 320 px WebP of an image record; null for a video, a missing file or bytes that do not decode. */
export async function mediaThumbnail(
  deps: MediaDeps,
  record: MediaRecord,
): Promise<Uint8Array | null> {
  if (record.kind !== "image") return null;
  const stream = await openMedia(deps, record);
  if (stream === null) return null;
  return deps.encoder.thumbnail(await collect(stream), record.contentType, THUMBNAIL_MAX_SIDE);
}

/** The provider's view URL of a stored video with no staging copy left; null otherwise (stream it instead). */
export async function videoViewUrl(deps: MediaDeps, record: MediaRecord): Promise<string | null> {
  if (record.kind !== "video" || record.status !== "stored" || record.stagingRef !== null)
    return null;
  const ref = record.providerRef ?? deps.durable.refForKey(record.durableKey);
  return deps.durable.viewUrl(ref, VIEW_URL_TTL_SECONDS);
}

/** A durable file by key, for the local view route; null for a key outside `forms/` or a missing file. */
export async function openStoredKey(
  deps: MediaDeps,
  key: string,
): Promise<ReadableStream<Uint8Array> | null> {
  if (!key.startsWith("forms/") || key.includes("..")) return null;
  return tryOpen(() => deps.durable.openRead(deps.durable.refForKey(key)));
}
