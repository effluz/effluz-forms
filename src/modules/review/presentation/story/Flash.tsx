import type { ReactElement } from "react";
import { Banner } from "@/shared/presentation/Banner";
import { MAX_STAFF_PHOTOS, MAX_STAFF_UPLOAD_FILES, type StoryView } from "../../application";
import { T, type ReviewCopyKey } from "../copy";
import { shortDay } from "../format";
import type { StoryDone, StoryError, StoryParams } from "../story-params";
import { story } from "./styles";

/** A copy row and its placeholders. */
export interface CopyLine {
  k: ReviewCopyKey;
  vars: Record<string, string>;
}

const ERROR_COPY: Record<StoryError, ReviewCopyKey> = {
  correction_blank: "st.err_correction_blank",
  correction_too_long: "st.err_correction_too_long",
  post_url_invalid: "pub.err_url",
  not_confirmed: "st.err_not_confirmed",
  source_invalid: "st.err_source",
  no_files: "st.err_no_files",
  too_many_files: "st.err_too_many_files",
  staff_photos_max: "st.err_staff_photos_max",
  file_too_large: "st.err_file_too_large",
  file_wrong_type: "st.err_file_wrong_type",
  file_unreadable: "st.err_file_unreadable",
  consent_missing: "st.laterphotos_off",
  no_photos_chosen: "st.err_no_photos_chosen",
  date_invalid: "st.err_date",
  published: "st.err_plan_published",
  reference_mismatch: "del.mismatch",
};

/** The limit a correction refused as too long, from the route (`n`) or the field. */
function correctionMax(view: StoryView, params: StoryParams): string {
  if (params.n !== null) return String(params.n);
  const field = view.pages
    .flatMap((page) => page.answers)
    .find((answer) => answer.field.key === params.edit);
  return field?.maxLength === null || field === undefined ? "" : String(field.maxLength);
}

/**
 * The words of the refusal in `params.error`, or null. The flash shows it at the top of the
 * page; the control it belongs to shows it again beneath itself, linked by `aria-describedby`.
 */
export function refusalLine(view: StoryView, params: StoryParams): CopyLine | null {
  const { error } = params;
  if (error === null) return null;
  const n = params.n === null ? "" : String(params.n);
  const vars: Record<string, string> =
    error === "correction_too_long"
      ? { max: correctionMax(view, params) }
      : error === "too_many_files"
        ? { max: params.n === null ? String(MAX_STAFF_UPLOAD_FILES) : n }
        : error === "staff_photos_max"
          ? { max: params.n === null ? String(MAX_STAFF_PHOTOS) : n }
          : { n };
  return { k: ERROR_COPY[error], vars };
}

/** The words of the flash in `params.done`, one or two lines, or none. */
function doneLines(view: StoryView, params: StoryParams): CopyLine[] {
  const done: StoryDone | null = params.done;
  const count = params.n ?? 0;
  switch (done) {
    case null:
      return [];
    case "saved":
      return [{ k: "st.saved", vars: {} }];
    case "reverted":
      return [{ k: "st.reverted", vars: {} }];
    case "published":
      return [{ k: "pub.saved", vars: {} }];
    case "unpublished":
      return [{ k: "pub.unmarked", vars: {} }];
    case "unpublished_waiting":
      return params.other === null
        ? [{ k: "pub.unmarked", vars: {} }]
        : [
            { k: "pub.unmarked", vars: {} },
            { k: "pub.unmark_waiting", vars: { ref: params.other } },
          ];
    case "photos_added":
      return [
        {
          k: count === 1 ? "st.photos_added_one" : "st.photos_added_other",
          vars: { count: String(count) },
        },
      ];
    case "photo_removed":
      return [{ k: "st.photo_removed", vars: {} }];
    case "planned":
      return view.plannedOn === null
        ? []
        : [{ k: "st.planned_saved", vars: { date: shortDay(view.plannedOn) } }];
    case "plan_cleared":
      return [{ k: "st.plan_cleared", vars: {} }];
    case "retried":
      return [{ k: "st.retried", vars: {} }];
    case "check_saved":
      return [{ k: "st.check_saved", vars: {} }];
    case "choice_saved":
      return [{ k: "st.choice_saved", vars: {} }];
  }
}

/**
 * The banners of the last change: its flash (a status) and its refusal (an alert). See
 * specs/ui-ux/manager.md, "Story page", item 4.
 */
export function Flash(props: { view: StoryView; params: StoryParams }): ReactElement | null {
  const lines = doneLines(props.view, props.params);
  const refusal = refusalLine(props.view, props.params);
  if (lines.length === 0 && refusal === null) return null;
  return (
    <>
      {lines.length === 0 ? null : (
        <Banner tone="success">
          {lines.map((line) => (
            <p key={line.k} className={story.flashLine}>
              <T k={line.k} vars={line.vars} />
            </p>
          ))}
        </Banner>
      )}
      {refusal === null ? null : (
        <Banner tone="danger">
          <T k={refusal.k} vars={refusal.vars} />
        </Banner>
      )}
    </>
  );
}
