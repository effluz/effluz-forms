import { useId, type ReactElement } from "react";
import { formatDate } from "@/shared/presentation/format-date";
import type { AnswerView, StoryView } from "../../application";
import { reviewDisplays } from "../answers";
import { T } from "../copy";
import { answerAnchor, storyPath, type StoryParams } from "../story-params";
import { CompareView } from "./CompareView";
import { CorrectionEditor } from "./CorrectionEditor";
import { Localized } from "./parts";
import { story } from "./styles";

/** "Edited" and who corrected the answer, when that is known. */
function EditedLine(props: {
  corrected: NonNullable<AnswerView["corrected"]>;
  timezone: string;
}): ReactElement {
  const { by, at } = props.corrected;
  return (
    <p className={story.edited}>
      <span className={story.tag}>
        <T k="st.edited_tag" />
      </span>
      {by === null || at === null ? null : (
        <span>
          <T k="st.edited_by" vars={{ name: by, date: formatDate(at, props.timezone).local }} />
        </span>
      )}
    </p>
  );
}

/**
 * One answer: its label, then its field type's review display, or, when opened with `?edit=`
 * or `?compare=`, the editor or the comparison in its place. A curatable text shows Edit, and
 * once corrected the Edited tag and Compare with original; other types have no actions.
 */
function Answer(props: {
  view: StoryView;
  answer: AnswerView;
  params: StoryParams;
  csrfToken: string;
}): ReactElement {
  const { view, answer, params } = props;
  const key = answer.field.key;
  const { corrected } = answer;
  const editing = answer.curatable && params.edit === key;
  const comparing = !editing && corrected !== null && params.compare === key;
  const Display = reviewDisplays[answer.field.type].Component;
  const labelId = useId();
  // Edit and Compare return to this answer's block, so the page does not reload at its top.
  const at = (over: Partial<Omit<StoryParams, "query">>) =>
    storyPath(view.ctx.form.id, view.reference, params.query, over, answerAnchor(key));
  return (
    <div className={story.answer} id={answerAnchor(key)}>
      <dt id={labelId} className={story.answerLabel}>
        <Localized text={answer.field.label} languages={answer.languages} />
      </dt>
      <dd className={story.answerValue}>
        {editing ? (
          <CorrectionEditor
            view={view}
            answer={answer}
            params={params}
            csrfToken={props.csrfToken}
          />
        ) : comparing ? (
          <CompareView
            view={view}
            answer={answer}
            corrected={corrected.text}
            params={params}
            labelId={labelId}
          />
        ) : (
          <>
            <Display view={answer} />
            {corrected === null ? null : (
              <EditedLine corrected={corrected} timezone={view.ctx.form.settings.timezone} />
            )}
            {answer.curatable ? (
              <ul className={story.actions}>
                {corrected === null ? null : (
                  <li>
                    <a
                      className={story.tertiary}
                      href={at({ compare: key })}
                      aria-describedby={labelId}
                    >
                      <T k="st.compare" />
                    </a>
                  </li>
                )}
                <li>
                  <a className={story.tertiary} href={at({ edit: key })} aria-describedby={labelId}>
                    <T k="st.edit" />
                  </a>
                </li>
              </ul>
            ) : null}
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * The answers, grouped under their page titles, each through its field type's review display.
 * See specs/ui-ux/manager.md, "Story page", item 5.
 */
export function AnswersCard(props: {
  view: StoryView;
  params: StoryParams;
  csrfToken: string;
}): ReactElement {
  const { view } = props;
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={story.card}>
      <h2 id={titleId} className={story.cardTitle}>
        <T k="st.answers" />
      </h2>
      {view.pages.map((page) => (
        <div key={page.key}>
          <h3 className={story.pageTitle}>
            <Localized
              text={page.title}
              languages={page.answers[0]?.languages ?? view.ctx.form.languages}
            />
          </h3>
          <dl className={story.answers}>
            {page.answers.map((answer) => (
              <Answer
                key={answer.field.key}
                view={view}
                answer={answer}
                params={props.params}
                csrfToken={props.csrfToken}
              />
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
