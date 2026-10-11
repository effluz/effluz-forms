// Key schemes for stored media. No key carries personal data: only the form
// slug, the submission reference, a position and a slug of the field label.
// See specs/system/media-storage.md.

export const MAX_FIELD_SLUG = 40;
export const STAGING_ROOT = "in-progress";

/** An ASCII slug of a field label, at most MAX_FIELD_SLUG characters, `file` when empty. */
export function fieldSlug(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_FIELD_SLUG)
    .replace(/-+$/g, "");
  return slug === "" ? "file" : slug;
}

/** Slugs per field key; the second and later fields sharing a slug get `-2`, `-3`, in field order. */
export function uniqueFieldSlugs(
  fields: readonly { fieldKey: string; label: string }[],
): Map<string, string> {
  const seen = new Map<string, number>();
  const slugs = new Map<string, string>();
  for (const { fieldKey, label } of fields) {
    const base = fieldSlug(label);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    slugs.set(fieldKey, count === 1 ? base : `${base}-${String(count)}`);
  }
  return slugs;
}

export function durableKey(parts: {
  formSlug: string;
  reference: string;
  position: number;
  fieldSlug: string;
  ext: string;
}): string {
  const nn = String(parts.position).padStart(2, "0");
  return `forms/${parts.formSlug}/${parts.reference}/${nn}-${parts.fieldSlug}.${parts.ext}`;
}

/** The staging prefix of one record: a single prefix delete removes all its files. */
export function stagingPrefix(recordId: string): string {
  return `${STAGING_ROOT}/${recordId}/`;
}

export function stagingKey(recordId: string, fileId: string, ext: string): string {
  return `${stagingPrefix(recordId)}${fileId}.${ext}`;
}
