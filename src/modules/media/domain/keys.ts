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

/**
 * Slugs per field key; the second and later fields sharing a slug get `-2`,
 * `-3`, in field order. A suffix is raised until the slug is free, so a label
 * that is itself `photos-2` cannot collide, and the base is trimmed first so
 * the suffixed slug stays within MAX_FIELD_SLUG.
 */
export function uniqueFieldSlugs(
  fields: readonly { fieldKey: string; label: string }[],
): Map<string, string> {
  const taken = new Set<string>();
  const slugs = new Map<string, string>();
  for (const { fieldKey, label } of fields) {
    const base = fieldSlug(label);
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) {
      const suffix = `-${String(n)}`;
      slug = `${base.slice(0, MAX_FIELD_SLUG - suffix.length).replace(/-+$/g, "")}${suffix}`;
    }
    taken.add(slug);
    slugs.set(fieldKey, slug);
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(id: string, what: string): string {
  if (!UUID.test(id)) throw new Error(`staging ${what} is not a UUID`);
  return id;
}

/**
 * The staging prefix of one record: a single prefix delete removes all its
 * files. Refuses an id that is not a UUID, which could resolve the prefix to
 * the staging root.
 */
export function stagingPrefix(recordId: string): string {
  return `${STAGING_ROOT}/${requireUuid(recordId, "record id")}/`;
}

export function stagingKey(recordId: string, fileId: string, ext: string): string {
  return `${stagingPrefix(recordId)}${requireUuid(fileId, "file id")}.${ext}`;
}
