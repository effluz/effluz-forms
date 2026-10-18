import { useId, type ReactElement } from "react";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { formatDate } from "@/shared/presentation/format-date";
import { cx, styles as ui } from "@/shared/presentation/styles";
import type { PhotoView, StaffPhotoSource, StoryView } from "../../application";
import { both, T, type ReviewCopyKey } from "../copy";
import { storyActionPath, storyPath, type StoryParams } from "../story-params";
import { styles } from "../styles";
import type { CopyLine } from "./Flash";
import { FilmIcon, StateIcon } from "./icons";
import { StoryDialog, StoryFields } from "./parts";
import { StaffPhotoForm } from "./StaffPhotoForm";
import { story } from "./styles";

type StoryProps = { view: StoryView; params: StoryParams; csrfToken: string };

/** A file of the story through the audited media route: `.../media/<id>?view=<view>`. */
export function mediaUrl(
  formId: string,
  reference: string,
  mediaId: string,
  view: "thumb" | "full" | "download",
): string {
  return `${storyActionPath(formId, reference, `media/${encodeURIComponent(mediaId)}`)}?view=${view}`;
}

/** The story's photos as a ZIP: `.../photos.zip?set=<set>`. */
export function zipUrl(formId: string, reference: string, set: "all" | "chosen"): string {
  return `${storyActionPath(formId, reference, "photos.zip")}?set=${set}`;
}

/**
 * "Photo n of total" or "Video n of total" for the file at `index` of the story's files: the
 * sender's first, then the team's, numbered across both. File names never show.
 */
export function photoCaption(photo: PhotoView, index: number, total: number): CopyLine {
  return {
    k: photo.kind === "video" ? "st.video_n" : "st.photo_n",
    vars: { n: String(index + 1), total: String(total) },
  };
}

const SOURCE_COPY: Record<StaffPhotoSource, ReviewCopyKey> = {
  whatsapp: "st.from_whatsapp",
  instagram: "st.from_instagram",
  email: "st.from_email",
  other: "st.from_other",
};

/**
 * One file: the thumbnail (or a film icon for a video), its caption, who added it and from
 * where for a team photo, a warning when it never reached Dropbox, then its actions as
 * stacked tertiary buttons, each described by the caption so it names its file. A chosen
 * tile has the 2 px border and says so in words with a check (components.md, "Photo tile
 * (staff)").
 */
function Tile(props: StoryProps & { photo: PhotoView; index: number }): ReactElement {
  const { view, params, photo } = props;
  const captionId = useId();
  const { form } = view.ctx;
  const { k, vars } = photoCaption(photo, props.index, view.photos.length);
  const postPlan = view.ctx.postPlan;
  const chosen = postPlan && photo.chosen;
  return (
    <li className={cx(styles.photoTile, chosen && styles.photoChosen)}>
      <div className={styles.photoFrame}>
        {photo.kind === "image" ? (
          // Thumbnails stream after the text (Doherty Threshold): lazy, at the tile's size.
          <img
            src={mediaUrl(form.id, view.reference, photo.mediaId, "thumb")}
            alt={both(k, vars)}
            loading="lazy"
            width={160}
            height={160}
          />
        ) : (
          <FilmIcon className={story.filmIcon} />
        )}
      </div>
      <p id={captionId} className={story.tileCaption}>
        <T k={k} vars={vars} />
      </p>
      {chosen ? (
        <p className={story.chosenMark}>
          <StateIcon done />
          <span>
            <T k="st.chosen" />
          </span>
        </p>
      ) : null}
      {photo.staff === null ? null : (
        <>
          <p className={story.tileMeta}>
            <T
              k="st.added_by"
              vars={{
                name: photo.staff.addedBy,
                date: formatDate(photo.staff.addedAt, form.settings.timezone).local,
              }}
            />
          </p>
          <p className={story.tileMeta}>
            <T k={SOURCE_COPY[photo.staff.source]} />
          </p>
        </>
      )}
      {photo.status === "failed" ? (
        <p className={story.tileWarning}>
          <T k="st.not_stored" />
        </p>
      ) : null}
      <div className={story.tileActions}>
        <a
          className={story.tertiary}
          href={storyPath(form.id, view.reference, params.query, { photo: photo.mediaId })}
          aria-describedby={captionId}
        >
          <T k="st.open_full" />
        </a>
        <a
          className={story.tertiary}
          href={mediaUrl(form.id, view.reference, photo.mediaId, "download")}
          aria-describedby={captionId}
        >
          <T k="st.download" />
        </a>
        {postPlan ? (
          <form
            className={story.tileForm}
            method="post"
            action={storyActionPath(form.id, view.reference, "choice")}
          >
            <StoryFields csrfToken={props.csrfToken} query={params.query} />
            <input type="hidden" name="media" value={photo.mediaId} />
            <input type="hidden" name="chosen" value={chosen ? "0" : "1"} />
            <button className={story.tertiaryButton} type="submit" aria-describedby={captionId}>
              <T k={chosen ? "st.unchoose" : "st.choose"} />
            </button>
          </form>
        ) : null}
        {photo.origin === "staff" ? (
          <a
            className={story.tertiary}
            href={storyPath(form.id, view.reference, params.query, {
              action: "remove_photo",
              media: photo.mediaId,
            })}
            aria-describedby={captionId}
          >
            <T k="st.remove_photo" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

/** A group of tiles under its heading. */
function Group(
  props: StoryProps & { title: ReviewCopyKey; files: { photo: PhotoView; index: number }[] },
): ReactElement | null {
  if (props.files.length === 0) return null;
  return (
    <>
      <h3 className={story.groupTitle}>
        <T k={props.title} />
      </h3>
      <ul className={story.photoGrid}>
        {props.files.map(({ photo, index }) => (
          <Tile
            key={photo.mediaId}
            view={props.view}
            params={props.params}
            csrfToken={props.csrfToken}
            photo={photo}
            index={index}
          />
        ))}
      </ul>
    </>
  );
}

/**
 * The Photos and videos card (`#photos`, the target of a file answer's link): the ZIP links,
 * the sender's files ("Sent with the form"), then the team's ("Added by the team"), then Add
 * photos on post-plan forms. Choosing a photo and adding photos are post-plan parts; a team
 * photo already added stays shown and removable, since it is still one of the story's files.
 * See specs/ui-ux/manager.md, "Story page", item 6.
 */
export function PhotosCard(props: StoryProps): ReactElement | null {
  const { view } = props;
  const { form, postPlan } = view.ctx;
  const titleId = useId();
  if (view.photos.length === 0 && !postPlan) return null;
  const files = view.photos.map((photo, index) => ({ photo, index }));
  const chosen = view.photos.filter((photo) => photo.chosen).length;
  return (
    <section id="photos" className={story.card} aria-labelledby={titleId}>
      <h2 id={titleId} className={story.cardTitle}>
        <T k="st.photos" />
      </h2>
      {view.photos.length === 0 ? null : (
        <ul className={story.zipLinks}>
          <li>
            <a className={ui.button} href={zipUrl(form.id, view.reference, "all")}>
              <T k="st.download_all" vars={{ count: String(view.photos.length) }} />
            </a>
          </li>
          {postPlan && chosen > 0 ? (
            <li>
              <a className={ui.button} href={zipUrl(form.id, view.reference, "chosen")}>
                <T k="st.download_chosen" vars={{ count: String(chosen) }} />
              </a>
            </li>
          ) : null}
        </ul>
      )}
      <Group
        {...props}
        title="st.sender_photos"
        files={files.filter(({ photo }) => photo.origin === "sender")}
      />
      <Group
        {...props}
        title="st.staff_photos"
        files={files.filter(({ photo }) => photo.origin === "staff")}
      />
      <StaffPhotoForm {...props} />
    </section>
  );
}

/**
 * The confirmation to remove a team photo (`?action=remove_photo&media=<id>`); null for any
 * other file, since the sender's photos cannot be removed one by one.
 */
export function RemovePhotoDialog(props: StoryProps): ReactElement | null {
  const { view, params } = props;
  const photo = view.photos.find((p) => p.mediaId === params.media && p.origin === "staff");
  if (photo === undefined) return null;
  const formId = view.ctx.form.id;
  return (
    <StoryDialog title={<T k="st.remove_photo" />} body={<T k="st.remove_photo_confirm" />}>
      {() => (
        <form
          className={ui.dialogForm}
          method="post"
          action={storyActionPath(formId, view.reference, "photos/remove")}
        >
          <StoryFields csrfToken={props.csrfToken} query={params.query} />
          <input type="hidden" name="media" value={photo.mediaId} />
          <div className={ui.actions}>
            <a className={ui.button} href={storyPath(formId, view.reference, params.query)}>
              <Bilingual k="shell.cancel" />
            </a>
            <button className={ui.destructive} type="submit">
              <T k="st.remove_photo" />
            </button>
          </div>
        </form>
      )}
    </StoryDialog>
  );
}
