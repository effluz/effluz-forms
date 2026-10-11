export const MEDIA_KINDS = ["image", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * The accepted content types, their kind and their stored extension. See
 * specs/system/media-storage.md, "File handling rules". HEIF is stored with
 * the `heic` extension.
 */
export const ACCEPTED_TYPES = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "image/webp": { kind: "image", ext: "webp" },
  "image/heic": { kind: "image", ext: "heic" },
  "image/heif": { kind: "image", ext: "heic" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
} as const satisfies Record<string, { kind: MediaKind; ext: string }>;

export type AcceptedType = keyof typeof ACCEPTED_TYPES;

/** The accepted type a MIME string names, or null when it is not accepted. */
export function acceptedType(mime: string | null): AcceptedType | null {
  if (mime === null || !Object.hasOwn(ACCEPTED_TYPES, mime)) return null;
  return mime as AcceptedType;
}

/** The stored extension for an accepted content type; throws for any other. */
export function extensionFor(contentType: string): string {
  const type = acceptedType(contentType);
  if (type === null) throw new Error(`no extension for ${contentType}`);
  return ACCEPTED_TYPES[type].ext;
}

export const MEDIA_STATUSES = ["staged", "stored", "failed"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/**
 * A file accepted into staging. `id` is also the media row id and the entry
 * in the `file_upload` answer.
 */
export interface StagedFile {
  id: string;
  stagingRef: string;
  kind: MediaKind;
  contentType: string;
  size: number;
}

export interface MediaRecord {
  id: string;
  submissionId: string;
  formId: string;
  fieldKey: string;
  position: number;
  kind: MediaKind;
  status: MediaStatus;
  contentType: string;
  size: number;
  stagingRef: string | null;
  durableKey: string;
  providerRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}
