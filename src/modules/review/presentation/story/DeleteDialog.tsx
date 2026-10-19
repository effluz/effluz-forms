import { useId, type ReactElement } from "react";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { literalPattern } from "@/shared/presentation/ConfirmForm";
import { bothLanguages } from "@/shared/presentation/copy";
import { styles as ui } from "@/shared/presentation/styles";
import type { StoryView } from "../../application";
import { reviewCopy, T } from "../copy";
import { STORY_DIALOG_ID, storyActionPath, storyPath, type StoryParams } from "../story-params";
import { StoryDialog, StoryFields } from "./parts";
import { story } from "./styles";

/** "Reference: ST-0001" in both languages, for the input's `title`. */
function typedTitle(reference: string): string {
  const label = reviewCopy["del.reference"];
  return bothLanguages({ en: `${label.en}: ${reference}`, es: `${label.es}: ${reference}` });
}

/** "Delete submission", the way into the confirmation (`?action=delete`): item 11 of the page. */
export function DeleteLink(props: { view: StoryView; params: StoryParams }): ReactElement {
  const { view } = props;
  return (
    <p>
      <a
        className={ui.button}
        href={storyPath(
          view.ctx.form.id,
          view.reference,
          props.params.query,
          { action: "delete" },
          STORY_DIALOG_ID,
        )}
      >
        <T k="st.delete" />
      </a>
    </p>
  );
}

/**
 * The delete confirmation: it names the reference, says the Dropbox files go too and that
 * this cannot be undone, and asks for the reference typed (the browser checks it with
 * `pattern`, the route again). A mismatch sent back by the route sits under the field. See
 * specs/ui-ux/manager.md, "Delete".
 */
export function DeleteDialog(props: {
  view: StoryView;
  params: StoryParams;
  csrfToken: string;
}): ReactElement {
  const { view, params } = props;
  const id = useId();
  const inputId = `${id}-typed`;
  const expectedId = `${id}-expected`;
  const errorId = `${id}-error`;
  const mismatch = params.error === "reference_mismatch";
  const formId = view.ctx.form.id;
  return (
    <StoryDialog
      title={<T k="st.delete" />}
      body={<T k="del.body" vars={{ ref: view.reference }} />}
    >
      {({ bodyId }) => (
        <form
          className={ui.dialogForm}
          method="post"
          action={storyActionPath(formId, view.reference, "delete")}
        >
          <StoryFields csrfToken={props.csrfToken} query={params.query} />
          <div className={story.typedField}>
            <label htmlFor={inputId} className={ui.label}>
              <T k="del.reference" />
            </label>
            {/* The value to type, shown and read out, so nobody has to guess it. */}
            <code id={expectedId} className={ui.expected}>
              {view.reference}
            </code>
            <input
              id={inputId}
              className={ui.input}
              type="text"
              name="typed"
              required
              pattern={literalPattern(view.reference)}
              // The browser's validation message adds the title, so it names the value.
              title={typedTitle(view.reference)}
              aria-describedby={
                mismatch ? `${expectedId} ${errorId} ${bodyId}` : `${expectedId} ${bodyId}`
              }
              {...(mismatch ? { "aria-invalid": true as const } : {})}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            {mismatch ? (
              <p id={errorId} className={story.fieldError}>
                <T k="del.mismatch" />
              </p>
            ) : null}
          </div>
          <div className={ui.actions}>
            <a className={ui.button} href={storyPath(formId, view.reference, params.query)}>
              <Bilingual k="shell.cancel" />
            </a>
            <button className={ui.destructive} type="submit">
              <T k="del.confirm" />
            </button>
          </div>
        </form>
      )}
    </StoryDialog>
  );
}
