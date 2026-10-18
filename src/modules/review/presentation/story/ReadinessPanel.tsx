import { useId, type ReactElement } from "react";
import { formatDate } from "@/shared/presentation/format-date";
import { cx, styles as ui } from "@/shared/presentation/styles";
import type { StoryCheck, StoryView } from "../../application";
import { T, type ReviewCopyKey } from "../copy";
import { storyActionPath, type StoryParams } from "../story-params";
import { styles } from "../styles";
import { refusalLine } from "./Flash";
import { StateIcon } from "./icons";
import { StoryFields } from "./parts";
import { PlanForm } from "./PlanForm";
import { story } from "./styles";

type StoryProps = { view: StoryView; params: StoryParams; csrfToken: string };

/** A tick button: it names what it does, "Mark ..." when off and "... not ... yet" when on. */
const TICK: Record<StoryCheck, { mark: ReviewCopyKey; unmark: ReviewCopyKey }> = {
  photos_edited: { mark: "st.mark_edited", unmark: "st.unmark_edited" },
  text_checked: { mark: "st.mark_text", unmark: "st.unmark_text" },
};

/** The form that ticks or unticks one check, posting `check` and `value`. */
function TickForm(
  props: StoryProps & { check: StoryCheck; on: boolean; describedBy: string | null },
): ReactElement {
  const { view, params } = props;
  return (
    <form
      className={story.inlineForm}
      method="post"
      action={storyActionPath(view.ctx.form.id, view.reference, "check")}
    >
      <StoryFields csrfToken={props.csrfToken} query={params.query} />
      <input type="hidden" name="check" value={props.check} />
      <input type="hidden" name="value" value={props.on ? "0" : "1"} />
      <button
        className={ui.button}
        type="submit"
        {...(props.describedBy === null ? {} : { "aria-describedby": props.describedBy })}
      >
        <T k={props.on ? TICK[props.check].unmark : TICK[props.check].mark} />
      </button>
    </form>
  );
}

/** Who ticked a check and when: "owner@example.com, 2026-10-17 10:30 America/Panama". */
function TickedBy(props: {
  view: StoryView;
  by: { by: string; at: Date } | null;
}): ReactElement | null {
  if (props.by === null) return null;
  const { local } = formatDate(props.by.at, props.view.ctx.form.settings.timezone);
  return (
    <p className={story.checkNote}>
      <T k="st.checked_by" vars={{ name: props.by.by, date: local }} />
    </p>
  );
}

/**
 * Ready to post? (`#readiness`, post-plan forms only): "Ready" or "Not ready: n of 3 done",
 * the three checks, each an icon (tick or cross), its name and "Done" or "Missing" in words,
 * so the state never rests on colour; the two tick buttons with who ticked them; the stale
 * notice when the chosen photos changed after they were edited; then the planned date. The
 * words sit inside the element that carries the colour (design-system/components.md,
 * "Readiness checks"). See specs/ui-ux/manager.md, "Story page", item 7.
 */
export function ReadinessPanel(props: StoryProps): ReactElement | null {
  const { view, params } = props;
  const id = useId();
  if (!view.ctx.postPlan) return null;
  const titleId = `${id}-title`;
  const errorId = `${id}-error`;
  const r = view.readiness;
  const noPhotos = params.error === "no_photos_chosen" ? refusalLine(view, params) : null;
  const rows = [
    { key: "chosen", name: "st.check_chosen", done: r.photosChosen, tick: null },
    { key: "edited", name: "st.check_edited", done: r.photosEdited, tick: "photos_edited" },
    { key: "text", name: "st.check_text", done: r.textChecked, tick: "text_checked" },
  ] as const;
  return (
    <section id="readiness" className={story.card} aria-labelledby={titleId}>
      <h2 id={titleId} className={story.cardTitle}>
        <T k="st.readiness" />
      </h2>
      <p className={cx(styles.checkSummary, story.checkSummary)}>
        {r.ready ? <T k="st.ready" /> : <T k="st.not_ready" vars={{ n: String(r.done) }} />}
      </p>
      <ul className={styles.checks}>
        {rows.map((row) => (
          <li
            key={row.key}
            className={cx(styles.check, row.done ? styles.checkDone : styles.checkMissing)}
          >
            <StateIcon done={row.done} />
            <span className={styles.checkWords}>
              <T k={row.name} />
            </span>{" "}
            <span className={styles.checkWords}>
              <T k={row.done ? "st.check_done" : "st.check_missing"} />
            </span>
            {row.tick === null ? null : (
              <div className={story.checkExtra}>
                <TickedBy
                  view={view}
                  by={
                    !row.done
                      ? null
                      : row.tick === "photos_edited"
                        ? view.photosEditedBy
                        : view.textCheckedBy
                  }
                />
                {row.tick === "photos_edited" && view.editedStale ? (
                  <p className={story.checkNote}>
                    <T k="st.edited_stale" />
                  </p>
                ) : null}
                <TickForm
                  {...props}
                  check={row.tick}
                  on={row.done}
                  describedBy={row.tick === "photos_edited" && noPhotos !== null ? errorId : null}
                />
                {row.tick === "photos_edited" && noPhotos !== null ? (
                  <p id={errorId} className={story.fieldError}>
                    <T k={noPhotos.k} vars={noPhotos.vars} />
                  </p>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
      <PlanForm {...props} />
    </section>
  );
}
