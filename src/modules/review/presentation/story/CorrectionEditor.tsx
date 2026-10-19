import { useId, type ReactElement } from "react";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { styles as ui } from "@/shared/presentation/styles";
import type { AnswerView, StoryView } from "../../application";
import { T } from "../copy";
import { answerAnchor, storyActionPath, storyPath, type StoryParams } from "../story-params";
import { refusalLine } from "./Flash";
import { StoryFields } from "./parts";
import { story } from "./styles";

/** The sender's text of a curatable answer (always a string, `curatable` says so). */
export function originalText(answer: AnswerView): string {
  return typeof answer.answer === "string" ? answer.answer : "";
}

/**
 * The correction editor, in place of the answer: the hint, then Original (read only) and
 * Corrected (a textarea with `required` and the field's `maxlength`) side by side from 768 px,
 * Save correction and Cancel. A refusal sits under the textarea, linked by
 * `aria-describedby`. See specs/ui-ux/manager.md, "Edit a text answer".
 */
export function CorrectionEditor(props: {
  view: StoryView;
  answer: AnswerView;
  params: StoryParams;
  csrfToken: string;
}): ReactElement {
  const { view, answer, params } = props;
  const id = useId();
  const hintId = `${id}-hint`;
  const originalId = `${id}-original`;
  const areaId = `${id}-corrected`;
  const errorId = `${id}-error`;
  const refused =
    params.error === "correction_blank" || params.error === "correction_too_long"
      ? refusalLine(view, params)
      : null;
  const original = originalText(answer);
  return (
    <form method="post" action={storyActionPath(view.ctx.form.id, view.reference, "correction")}>
      <StoryFields csrfToken={props.csrfToken} query={params.query} />
      <input type="hidden" name="field" value={answer.field.key} />
      <p id={hintId} className={story.hint}>
        <T k="st.correction_hint" />
      </p>
      <div className={story.columns}>
        <div className={story.column}>
          <p id={originalId} className={story.columnLabel}>
            <T k="st.original" />
          </p>
          <p className={story.readOnly} role="group" aria-labelledby={originalId}>
            {original}
          </p>
        </div>
        <div className={story.column}>
          <label htmlFor={areaId} className={story.columnLabel}>
            <T k="st.corrected" />
          </label>
          <textarea
            id={areaId}
            className={story.textarea}
            name="text"
            required
            {...(answer.maxLength === null ? {} : { maxLength: answer.maxLength })}
            rows={8}
            defaultValue={answer.corrected?.text ?? original}
            aria-describedby={refused === null ? hintId : `${hintId} ${errorId}`}
            {...(refused === null ? {} : { "aria-invalid": true as const })}
          />
          {refused === null ? null : (
            <p id={errorId} className={story.fieldError}>
              <T k={refused.k} vars={refused.vars} />
            </p>
          )}
        </div>
      </div>
      <div className={ui.actions}>
        <a
          className={ui.button}
          href={storyPath(
            view.ctx.form.id,
            view.reference,
            params.query,
            {},
            answerAnchor(answer.field.key),
          )}
        >
          <Bilingual k="shell.cancel" />
        </a>
        <button className={ui.primary} type="submit">
          <T k="st.save" />
        </button>
      </div>
    </form>
  );
}
