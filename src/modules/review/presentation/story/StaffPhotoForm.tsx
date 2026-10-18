import { useId, type ReactElement } from "react";
import { styles as ui } from "@/shared/presentation/styles";
import { STAFF_PHOTO_SOURCES, type StaffPhotoSource, type StoryView } from "../../application";
import { T, type ReviewCopyKey } from "../copy";
import { storyActionPath, type StoryError, type StoryParams } from "../story-params";
import { styles } from "../styles";
import { refusalLine, type CopyLine } from "./Flash";
import { StoryFields } from "./parts";
import { story } from "./styles";

/**
 * The content types the upload offers, the public ones (specs/system/media-storage.md, "File
 * handling rules"); the route checks every file by its content again.
 */
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime";

const SOURCE_LABEL: Record<StaffPhotoSource, ReviewCopyKey> = {
  whatsapp: "st.source_whatsapp",
  instagram: "st.source_instagram",
  email: "st.source_email",
  other: "st.source_other",
};

/** The control each refusal of the upload route belongs to. */
const REFUSAL_CONTROL: Partial<Record<StoryError, "files" | "source" | "confirmed">> = {
  no_files: "files",
  too_many_files: "files",
  staff_photos_max: "files",
  file_too_large: "files",
  file_wrong_type: "files",
  file_unreadable: "files",
  source_invalid: "source",
  not_confirmed: "confirmed",
};

/** The `aria-describedby` and `aria-invalid` of a control, given its hint and its refusal. */
function described(ids: (string | null)[], invalid: boolean) {
  const list = ids.filter((id) => id !== null).join(" ");
  return {
    ...(list === "" ? {} : { "aria-describedby": list }),
    ...(invalid ? { "aria-invalid": true as const } : {}),
  };
}

function FieldError(props: { id: string; line: CopyLine }): ReactElement {
  return (
    <p id={props.id} className={story.fieldError}>
      <T k={props.line.k} vars={props.line.vars} />
    </p>
  );
}

/**
 * Add photos, on post-plan forms: files the sender sent later, where they came from, and the
 * required tick that the sender sent them for this story, posted as one multipart form (no
 * script). A refusal sits under the control it names, linked by `aria-describedby`. Without
 * the consent line for later photos in the form's current version, `st.laterphotos_off`
 * takes its place. See specs/ui-ux/manager.md, "Story page".
 */
export function StaffPhotoForm(props: {
  view: StoryView;
  params: StoryParams;
  csrfToken: string;
}): ReactElement | null {
  const { view, params } = props;
  const id = useId();
  if (!view.ctx.postPlan) return null;
  const titleId = `${id}-title`;
  if (!view.ctx.laterPhotosAllowed) {
    return (
      <div className={story.addPhotos}>
        <h3 id={titleId} className={story.groupTitle}>
          <T k="st.add_photos" />
        </h3>
        <p className={story.hint}>
          <T k="st.laterphotos_off" />
        </p>
      </div>
    );
  }
  const control = params.error === null ? undefined : REFUSAL_CONTROL[params.error];
  const refusal = control === undefined ? null : refusalLine(view, params);
  const errorId = `${id}-error`;
  const filesId = `${id}-files`;
  const hintId = `${id}-hint`;
  const confirmedId = `${id}-confirmed`;
  const at = (name: "files" | "source" | "confirmed") =>
    refusal !== null && control === name ? refusal : null;
  const filesError = at("files");
  const sourceError = at("source");
  const confirmedError = at("confirmed");
  return (
    <div className={story.addPhotos}>
      <h3 id={titleId} className={story.groupTitle}>
        <T k="st.add_photos" />
      </h3>
      <form
        className={story.uploadForm}
        method="post"
        encType="multipart/form-data"
        action={storyActionPath(view.ctx.form.id, view.reference, "photos")}
        aria-labelledby={titleId}
      >
        <StoryFields csrfToken={props.csrfToken} query={params.query} />
        <div className={ui.field}>
          <label htmlFor={filesId} className={ui.label}>
            <T k="st.files" />
          </label>
          <p id={hintId} className={story.hint}>
            <T k="st.add_photos_hint" />
          </p>
          <div className={story.dropzone}>
            <input
              id={filesId}
              type="file"
              name="files"
              multiple
              required
              accept={ACCEPT}
              {...described([hintId, filesError === null ? null : errorId], filesError !== null)}
            />
          </div>
          {filesError === null ? null : <FieldError id={errorId} line={filesError} />}
        </div>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>
            <T k="st.from_where" />
          </legend>
          {STAFF_PHOTO_SOURCES.map((source) => (
            <div key={source} className={styles.choice}>
              <input
                id={`${id}-source-${source}`}
                type="radio"
                name="source"
                value={source}
                required
                {...described([sourceError === null ? null : errorId], sourceError !== null)}
              />
              <label htmlFor={`${id}-source-${source}`}>
                <T k={SOURCE_LABEL[source]} />
              </label>
            </div>
          ))}
          {sourceError === null ? null : <FieldError id={errorId} line={sourceError} />}
        </fieldset>
        <div className={story.confirmField}>
          <div className={styles.choice}>
            <input
              id={confirmedId}
              type="checkbox"
              name="confirmed"
              value="1"
              required
              {...described([confirmedError === null ? null : errorId], confirmedError !== null)}
            />
            <label htmlFor={confirmedId}>
              <T k="st.sender_confirmed" />
            </label>
          </div>
          {confirmedError === null ? null : <FieldError id={errorId} line={confirmedError} />}
        </div>
        <div>
          <button className={ui.button} type="submit">
            <T k="st.upload" />
          </button>
        </div>
      </form>
    </div>
  );
}
