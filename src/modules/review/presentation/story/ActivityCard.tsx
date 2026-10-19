import { useId, type ReactElement } from "react";
import { Bilingual, BilingualText } from "@/shared/presentation/Bilingual";
import { copy, type CopyKey } from "@/shared/presentation/copy";
import { formatDate } from "@/shared/presentation/format-date";
import { reviewAuditActions, type StoryView } from "../../application";
import { T } from "../copy";
import { story } from "./styles";

/** The plain-words label of a stored action; an action review does not write is shown as stored. */
function ActionLabel(props: { action: string }): ReactElement {
  const known = reviewAuditActions.find((name) => name === props.action);
  if (known === undefined) return <>{props.action}</>;
  const key: CopyKey = `au.action_${known}`;
  return <BilingualText text={copy[key]} />;
}

/**
 * The audit entries of this submission, newest first: when, who and what. See
 * specs/ui-ux/manager.md, "Story page", item 10.
 */
export function ActivityCard(props: { view: StoryView }): ReactElement {
  const { view } = props;
  const titleId = useId();
  const timezone = view.ctx.form.settings.timezone;
  return (
    <section aria-labelledby={titleId} className={story.card}>
      <h2 id={titleId} className={story.cardTitle}>
        <T k="st.activity" />
      </h2>
      {view.activity.length === 0 ? (
        <p>
          <T k="st.activity_empty" />
        </p>
      ) : (
        <ol className={story.activity}>
          {view.activity.map((entry) => (
            <li key={entry.id}>
              <time className={story.activityTime} dateTime={entry.at.toISOString()}>
                {formatDate(entry.at, timezone).local}
              </time>
              <span className={story.activityAction}>
                <ActionLabel action={entry.action} />
              </span>
              <span>
                {entry.actorEmail === null ? <Bilingual k="au.system" /> : entry.actorEmail}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
