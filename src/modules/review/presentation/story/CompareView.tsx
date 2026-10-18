import { Fragment, useId, type ReactElement } from "react";
import {
  changeCount,
  wordDiff,
  type AnswerView,
  type DiffPart,
  type StoryView,
} from "../../application";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { styles as ui } from "@/shared/presentation/styles";
import { T } from "../copy";
import { storyActionPath, storyPath, type StoryParams } from "../story-params";
import { originalText } from "./CorrectionEditor";
import { localized, StoryDialog, StoryFields, TPer } from "./parts";
import { story } from "./styles";

/**
 * One column of the comparison: the unchanged words and the changes of one kind, each change
 * an `<ins>` or `<del>` with its kind in words for assistive technology, reachable with Tab.
 */
function Column(props: {
  label: "st.original" | "st.corrected";
  parts: DiffPart[];
  shown: "removed" | "added";
}): ReactElement {
  const labelId = useId();
  return (
    <div className={story.column}>
      <p id={labelId} className={story.columnLabel}>
        <T k={props.label} />
      </p>
      <p className={story.readOnly} role="group" aria-labelledby={labelId}>
        {props.parts.map((part, i) => {
          // A diff is fixed for a render, so the position is a stable key.
          if (part.kind === "same") return <Fragment key={i}>{part.text}</Fragment>;
          if (part.kind !== props.shown) return null;
          const Mark = part.kind === "added" ? "ins" : "del";
          return (
            <Mark key={i} tabIndex={0}>
              <span className={story.visuallyHidden}>
                <T k={part.kind === "added" ? "st.added" : "st.removed"} />{" "}
              </span>
              {part.text}
            </Mark>
          );
        })}
      </p>
    </div>
  );
}

/**
 * The original and the corrected text side by side, read only, with every change marked, the
 * number of changes as a polite status, and Edit, Revert to original and Back to the story.
 * See specs/ui-ux/manager.md, "Edit a text answer".
 */
export function CompareView(props: {
  view: StoryView;
  answer: AnswerView;
  corrected: string;
  params: StoryParams;
}): ReactElement {
  const { view, answer, params } = props;
  const parts = wordDiff(originalText(answer), props.corrected);
  const count = changeCount(parts);
  const at = (over: Partial<Omit<StoryParams, "query">>) =>
    storyPath(view.ctx.form.id, view.reference, params.query, over);
  const key = answer.field.key;
  return (
    <div>
      <p role="status" className={story.changeCount}>
        {count === 0 ? (
          <T k="st.no_changes" />
        ) : (
          <T k={count === 1 ? "st.changes_one" : "st.changes_other"} vars={{ n: String(count) }} />
        )}
      </p>
      <div className={story.columns}>
        <Column label="st.original" parts={parts} shown="removed" />
        <Column label="st.corrected" parts={parts} shown="added" />
      </div>
      <ul className={story.actions}>
        <li>
          <a className={story.tertiary} href={at({ edit: key })}>
            <T k="st.edit" />
          </a>
        </li>
        <li>
          <a className={story.tertiary} href={at({ action: "revert", field: key })}>
            <T k="st.revert" />
          </a>
        </li>
        <li>
          <a className={story.tertiary} href={at({})}>
            <T k="st.close_viewer" />
          </a>
        </li>
      </ul>
    </div>
  );
}

/**
 * The revert confirmation (`?action=revert&field=<key>`): it names the answer by its label in
 * each language and posts to the revert route. Cancel returns to the comparison.
 */
export function RevertDialog(props: {
  view: StoryView;
  answer: AnswerView;
  params: StoryParams;
  csrfToken: string;
}): ReactElement {
  const { view, answer, params } = props;
  const label = localized(answer.field.label, answer.languages);
  const key = answer.field.key;
  return (
    <StoryDialog
      title={<T k="st.revert" />}
      body={
        <TPer k="st.revert_confirm" vars={{ en: { label: label.en }, es: { label: label.es } }} />
      }
    >
      {() => (
        <form
          className={ui.dialogForm}
          method="post"
          action={storyActionPath(view.ctx.form.id, view.reference, "revert")}
        >
          <StoryFields csrfToken={props.csrfToken} query={params.query} />
          <input type="hidden" name="field" value={key} />
          <div className={ui.actions}>
            <a
              className={ui.button}
              href={storyPath(view.ctx.form.id, view.reference, params.query, { compare: key })}
            >
              <Bilingual k="shell.cancel" />
            </a>
            <button className={ui.primary} type="submit">
              <T k="st.revert" />
            </button>
          </div>
        </form>
      )}
    </StoryDialog>
  );
}
