import { useId, type ReactElement } from "react";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { styles as ui } from "@/shared/presentation/styles";
import type { StoryView } from "../../application";
import { T } from "../copy";
import { shortDay } from "../format";
import { storyActionPath, storyPath, type StoryParams } from "../story-params";
import { refusalLine } from "./Flash";
import { StoryDialog, StoryFields } from "./parts";
import { story } from "./styles";

type StoryProps = { view: StoryView; params: StoryParams; csrfToken: string };

/** The fields every plan post from the story page carries: it returns to the story. */
function PlanFields(props: StoryProps): ReactElement {
  return (
    <>
      <StoryFields csrfToken={props.csrfToken} query={props.params.query} />
      <input type="hidden" name="return" value="story" />
    </>
  );
}

/**
 * The plan conflict (`conflict_date`, `conflict_ref`, `conflict_swap=1`): the day already
 * holds another story, named here, with "Swap the two dates" (only when this story has a
 * date to give) and "Move <ref> to Waiting for a date", each a submit button posting the same
 * date and its `resolution`. It sits where the plan form was, which the route returns to
 * (`#plan`).
 */
function ConflictDialog(
  props: StoryProps & { conflict: NonNullable<StoryParams["conflict"]> },
): ReactElement {
  const { view, params, conflict } = props;
  const formId = view.ctx.form.id;
  return (
    <StoryDialog
      title={<T k="st.plan" />}
      body={<T k="st.plan_conflict" vars={{ ref: conflict.ref, date: shortDay(conflict.date) }} />}
    >
      {() => (
        <form
          className={ui.dialogForm}
          method="post"
          action={storyActionPath(formId, view.reference, "plan")}
        >
          <PlanFields {...props} />
          <input type="hidden" name="date" value={conflict.date} />
          <div className={ui.actions}>
            <a className={ui.button} href={storyPath(formId, view.reference, params.query)}>
              <Bilingual k="shell.cancel" />
            </a>
            <button
              className={conflict.canSwap ? ui.button : ui.primary}
              type="submit"
              name="resolution"
              value="move"
            >
              <T k="st.plan_move" vars={{ ref: conflict.ref }} />
            </button>
            {conflict.canSwap ? (
              <button className={ui.primary} type="submit" name="resolution" value="swap">
                <T k="st.plan_swap" />
              </button>
            ) : null}
          </div>
        </form>
      )}
    </StoryDialog>
  );
}

/**
 * The planned date (`#plan`, inside Ready to post?, post-plan forms only): one labelled date
 * field (`YYYY-MM-DD`, the hint linked to it) with Plan, and "Remove the date" as a second
 * form posting an empty date once the story is planned. A refused date sits under the field.
 * A published story stays on the day it went out, which the publishing card states, so it
 * offers no date to change. See specs/ui-ux/manager.md, "Plan a story".
 */
export function PlanForm(props: StoryProps): ReactElement | null {
  const { view, params } = props;
  const id = useId();
  if (!view.ctx.postPlan) return null;
  if (params.conflict !== null) {
    return (
      <div id="plan" className={story.planBlock}>
        <ConflictDialog {...props} conflict={params.conflict} />
      </div>
    );
  }
  if (view.status === "published") return null;
  const dateId = `${id}-date`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const refused =
    params.error === "date_invalid" || params.error === "published"
      ? refusalLine(view, params)
      : null;
  const action = storyActionPath(view.ctx.form.id, view.reference, "plan");
  return (
    <div id="plan" className={story.planBlock}>
      <form className={story.planForm} method="post" action={action}>
        <PlanFields {...props} />
        <label htmlFor={dateId} className={ui.label}>
          <T k="st.plan" />
        </label>
        <p id={hintId} className={story.hint}>
          <T k="st.plan_hint" />
        </p>
        <div className={story.planRow}>
          <input
            id={dateId}
            className={ui.input}
            type="date"
            name="date"
            defaultValue={view.plannedOn ?? ""}
            required
            aria-describedby={refused === null ? hintId : `${hintId} ${errorId}`}
            {...(refused === null ? {} : { "aria-invalid": true as const })}
          />
          <button className={ui.button} type="submit">
            <T k="st.plan_save" />
          </button>
        </div>
        {refused === null ? null : (
          <p id={errorId} className={story.fieldError}>
            <T k={refused.k} vars={refused.vars} />
          </p>
        )}
      </form>
      {view.plannedOn === null ? null : (
        <form className={story.inlineForm} method="post" action={action}>
          <PlanFields {...props} />
          <input type="hidden" name="date" value="" />
          <button className={ui.button} type="submit">
            <T k="st.plan_clear" />
          </button>
        </form>
      )}
    </div>
  );
}
