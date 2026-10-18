import { useId, type ReactElement } from "react";
import { styles as ui } from "@/shared/presentation/styles";
import type { StoryView } from "../../application";
import { both, T } from "../copy";
import { storyPath, type StoryParams } from "../story-params";
import { mediaUrl, photoCaption } from "./PhotosCard";
import { story } from "./styles";

/**
 * The in-page viewer (`?photo=<mediaId>`), above the cards: the full-size image or the native
 * video player (never autoplaying, loading nothing until asked), the caption as its heading,
 * where the file is kept, that views and downloads are recorded, then Previous, Next,
 * Download and Back to the story as plain links. Opening it is audited by the media route.
 * See specs/ui-ux/manager.md, "Photo viewer", and design-system/components.md, "Viewer".
 */
export function PhotoViewer(props: {
  view: StoryView;
  params: StoryParams;
  csrfToken: string;
}): ReactElement | null {
  const { view, params } = props;
  const captionId = useId();
  const index = view.photos.findIndex((p) => p.mediaId === params.photo);
  const photo = view.photos[index];
  if (params.photo === null || photo === undefined) return null;
  const { form } = view.ctx;
  const at = (over: Partial<Omit<StoryParams, "query">>) =>
    storyPath(form.id, view.reference, params.query, over);
  const previous = view.photos[index - 1];
  const next = view.photos[index + 1];
  const { k, vars } = photoCaption(photo, index, view.photos.length);
  const full = mediaUrl(form.id, view.reference, photo.mediaId, "full");
  return (
    <section className={story.viewer} aria-labelledby={captionId}>
      <h2 id={captionId} className={story.cardTitle}>
        <T k={k} vars={vars} />
      </h2>
      <div className={story.viewerMedia}>
        {photo.kind === "video" ? (
          <video className={story.viewerFile} controls preload="none" src={full} />
        ) : (
          <img className={story.viewerFile} src={full} alt={both(k, vars)} />
        )}
      </div>
      <p className={story.viewerFacts}>
        {photo.status === "stored" ? (
          <T k="st.in_dropbox" vars={{ path: photo.durableKey }} />
        ) : (
          <T k="st.not_stored" />
        )}
      </p>
      <p className={story.hint}>
        <T k="st.views_recorded" />
      </p>
      <ul className={story.viewerActions}>
        {previous === undefined ? null : (
          <li>
            <a className={ui.button} href={at({ photo: previous.mediaId })}>
              <T k="st.previous_photo" />
            </a>
          </li>
        )}
        {next === undefined ? null : (
          <li>
            <a className={ui.button} href={at({ photo: next.mediaId })}>
              <T k="st.next_photo" />
            </a>
          </li>
        )}
        <li>
          <a
            className={ui.button}
            href={mediaUrl(form.id, view.reference, photo.mediaId, "download")}
          >
            <T k="st.download" />
          </a>
        </li>
        <li>
          <a className={ui.button} href={at({})}>
            <T k="st.close_viewer" />
          </a>
        </li>
      </ul>
    </section>
  );
}
