import type { Locale } from "@/shared/domain/localized-text";
import { fill } from "@/shared/presentation/copy";
import type { ExportLabels } from "../application";
import { reviewCopy, type ReviewCopyKey } from "./copy";

/**
 * The fixed headers and status words of an export in `locale`, from the `ex.col_*`,
 * `ex.corrected_suffix` and `sub.status_*` copy rows (specs/ui-ux/manager.md, "Export").
 * The export's language is chosen by the application (`exportLocale`); the copy lives here.
 */
export function exportLabels(locale: Locale): ExportLabels {
  const text = (key: ReviewCopyKey): string => reviewCopy[key][locale];
  return {
    reference: text("ex.col_reference"),
    status: text("ex.col_status"),
    received: text("ex.col_received"),
    version: text("ex.col_version"),
    language: text("ex.col_language"),
    planned: text("ex.col_planned"),
    postLink: text("ex.col_post_link"),
    files: text("ex.col_files"),
    staffPhotos: text("ex.col_staff_photos"),
    corrected: (label) => fill(text("ex.corrected_suffix"), { label }),
    statuses: {
      new: text("sub.status_new"),
      viewed: text("sub.status_viewed"),
      edited: text("sub.status_edited"),
      published: text("sub.status_published"),
    },
  };
}
