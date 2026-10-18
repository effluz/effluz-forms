/**
 * The reserved field key staff photos are stored under. Form field keys are lowercase letters,
 * digits and underscores (`keySchema`), so a hyphenated key can never collide with a form field.
 */
export const STAFF_PHOTOS_FIELD_KEY = "staff-photos";

export const STAFF_PHOTO_SOURCES = ["whatsapp", "instagram", "email", "other"] as const;
export type StaffPhotoSource = (typeof STAFF_PHOTO_SOURCES)[number];

export const MAX_STAFF_UPLOAD_FILES = 10;
export const MAX_STAFF_PHOTOS = 30;
export const STAFF_FILE_MAX_BYTES = 10 * 1024 * 1024;

export function parseSource(value: string): StaffPhotoSource | null {
  return STAFF_PHOTO_SOURCES.find((s) => s === value) ?? null;
}
