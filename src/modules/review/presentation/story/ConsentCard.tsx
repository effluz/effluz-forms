import type { ReactElement } from "react";
import { cx } from "@/shared/presentation/styles";
import { formatDate } from "@/shared/presentation/format-date";
import type { StoryView } from "../../application";
import { T } from "../copy";
import { story } from "./styles";

/**
 * The consent the sender gave, collapsed: the accepted text version and the time. See
 * specs/ui-ux/manager.md, "Story page", item 9.
 */
export function ConsentCard(props: { view: StoryView }): ReactElement | null {
  const { consent } = props.view;
  if (consent === null) return null;
  const { local } = formatDate(consent.acceptedAt, props.view.ctx.form.settings.timezone);
  return (
    <details className={cx(story.card, story.consent)}>
      <summary>
        <T k="st.consent" />
      </summary>
      <p>
        <T k="st.consent_accepted" vars={{ date: local, n: consent.textVersion }} />
      </p>
    </details>
  );
}
