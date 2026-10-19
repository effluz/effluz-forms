import { useId, type ReactElement } from "react";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { cx, styles as ui } from "@/shared/presentation/styles";
import type { StoryView } from "../../application";
import { statusAfterUnpublish } from "../../domain/status";
import { both, T } from "../copy";
import { shortDay } from "../format";
import { storyActionPath, storyPath, type StoryParams } from "../story-params";
import { OutwardIcon } from "../icons";
import { StoryDialog, StoryFields } from "./parts";
import { story } from "./styles";

type StoryProps = { view: StoryView; params: StoryParams; csrfToken: string };

/** The number of corrected answers, which decides the status an unmark returns to. */
function corrections(view: StoryView): number {
  return view.pages.flatMap((page) => page.answers).filter((a) => a.corrected !== null).length;
}

/**
 * Publishing, on every form: "Mark as published", or once published the day it went out,
 * "Open the post" (a new tab, with the outward icon) and "Unmark as published". Both open
 * their in-page confirmation with `?action=`. See specs/ui-ux/manager.md, "Story page",
 * item 8, and "Mark as published".
 */
export function PublishPanel(props: StoryProps): ReactElement {
  const { view, params } = props;
  const titleId = useId();
  const at = (action: "publish" | "unpublish") =>
    storyPath(view.ctx.form.id, view.reference, params.query, { action });
  return (
    <section id="publishing" className={story.card} aria-labelledby={titleId}>
      <h2 id={titleId} className={story.cardTitle}>
        <T k="st.publishing" />
      </h2>
      {view.status === "published" ? (
        <>
          {view.publishedOn === null ? null : (
            <p className={story.publishLine}>
              <T k="st.published_on" vars={{ date: shortDay(view.publishedOn) }} />
            </p>
          )}
          {view.postUrl === null ? null : (
            <p className={story.publishLine}>
              <a className={ui.link} href={view.postUrl} rel="noopener noreferrer">
                <T k="st.open_post" />
                <OutwardIcon />
              </a>
            </p>
          )}
          <p className={story.publishLine}>
            <a className={ui.button} href={at("unpublish")}>
              <T k="st.unmark_published" />
            </a>
          </p>
        </>
      ) : (
        <p className={story.publishLine}>
          <a className={ui.button} href={at("publish")}>
            <T k="st.mark_published" />
          </a>
        </p>
      )}
    </section>
  );
}

/**
 * The mark-as-published confirmation (`?action=publish`): an optional link to the post, which
 * must start with `https://` (the browser checks the pattern, the route again), and Confirm.
 * A refused link sits under the field.
 */
export function PublishDialog(props: StoryProps): ReactElement | null {
  const { view, params } = props;
  const id = useId();
  if (view.status === "published") return null;
  const inputId = `${id}-url`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const refused = params.error === "post_url_invalid";
  const formId = view.ctx.form.id;
  return (
    <StoryDialog title={<T k="st.mark_published" />}>
      {() => (
        <form
          className={ui.dialogForm}
          method="post"
          action={storyActionPath(formId, view.reference, "status")}
        >
          <StoryFields csrfToken={props.csrfToken} query={params.query} />
          <input type="hidden" name="intent" value="publish" />
          <div className={ui.field}>
            <label htmlFor={inputId} className={ui.label}>
              <T k="pub.post_url" />
            </label>
            <p id={hintId} className={story.hint}>
              <T k="pub.post_url_hint" />
            </p>
            <input
              id={inputId}
              className={cx(ui.input, story.urlInput)}
              type="url"
              name="post_url"
              inputMode="url"
              autoComplete="off"
              pattern="https://.+"
              // The browser's validation message adds the title, so it says what is expected.
              title={both("pub.post_url_hint")}
              aria-describedby={refused ? `${hintId} ${errorId}` : hintId}
              {...(refused ? { "aria-invalid": true as const } : {})}
            />
            {refused ? (
              <p id={errorId} className={story.fieldError}>
                <T k="pub.err_url" />
              </p>
            ) : null}
          </div>
          <div className={ui.actions}>
            <a className={ui.button} href={storyPath(formId, view.reference, params.query)}>
              <Bilingual k="shell.cancel" />
            </a>
            <button className={ui.primary} type="submit">
              <T k="pub.mark_confirm" />
            </button>
          </div>
        </form>
      )}
    </StoryDialog>
  );
}

/**
 * The unmark confirmation (`?action=unpublish`): it says which status the story returns to,
 * Edited when it has corrections, else Viewed, and posts `intent=unpublish`.
 */
export function UnpublishDialog(props: StoryProps): ReactElement | null {
  const { view, params } = props;
  if (view.status !== "published") return null;
  const formId = view.ctx.form.id;
  const back = statusAfterUnpublish(corrections(view));
  return (
    <StoryDialog
      title={<T k="st.unmark_published" />}
      body={<T k={back === "edited" ? "pub.unmark_edited" : "pub.unmark_viewed"} />}
    >
      {() => (
        <form
          className={ui.dialogForm}
          method="post"
          action={storyActionPath(formId, view.reference, "status")}
        >
          <StoryFields csrfToken={props.csrfToken} query={params.query} />
          <input type="hidden" name="intent" value="unpublish" />
          <div className={ui.actions}>
            <a className={ui.button} href={storyPath(formId, view.reference, params.query)}>
              <Bilingual k="shell.cancel" />
            </a>
            <button className={ui.primary} type="submit">
              <T k="pub.mark_confirm" />
            </button>
          </div>
        </form>
      )}
    </StoryDialog>
  );
}
