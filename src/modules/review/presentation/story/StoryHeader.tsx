import type { ReactElement } from "react";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { Breadcrumbs } from "@/shared/presentation/Breadcrumbs";
import { formatDate } from "@/shared/presentation/format-date";
import { styles as ui } from "@/shared/presentation/styles";
import { EMPTY_QUERY, type StoryView } from "../../application";
import { T } from "../copy";
import { shortDay } from "../format";
import { listHref } from "../list-view";
import { StatusBadge } from "../StatusBadge";
import { storyPath, type StoryParams } from "../story-params";
import { styles } from "../styles";
import { Localized } from "./parts";
import { story } from "./styles";

/** The status badge, or "Planned · <date>" for a planned story that has not gone out. */
function StatusMark(props: { view: StoryView }): ReactElement {
  const { view } = props;
  const planned =
    view.ctx.postPlan && view.plannedOn !== null && view.status !== "published"
      ? view.plannedOn
      : null;
  if (planned !== null) {
    return (
      <span className={styles.planned}>
        <T k="sub.planned_on" vars={{ date: shortDay(planned) }} />
      </span>
    );
  }
  return <StatusBadge status={view.status} />;
}

/**
 * The top of the story page: the breadcrumb, the `<h1>` with the reference and its status,
 * the received time (form zone and UTC), the version and the sender's language, then Newer,
 * Older and Back to the list, all following the list's query. See specs/ui-ux/manager.md,
 * "Story page", items 1 to 3.
 */
export function StoryHeader(props: { view: StoryView; params: StoryParams }): ReactElement {
  const { view } = props;
  const { query } = props.params;
  const { form } = view.ctx;
  const { local, utc } = formatDate(view.receivedAt, form.settings.timezone);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: <Bilingual k="nav.forms" />, href: "/admin/forms" },
          {
            label: <Localized text={form.title} languages={form.languages} />,
            href: listHref(form.id, EMPTY_QUERY),
          },
          { label: view.reference },
        ]}
      />
      <div className={story.titleRow}>
        <h1 className={ui.pageTitle}>{view.reference}</h1>
        <StatusMark view={view} />
      </div>
      <ul className={story.facts}>
        <li>
          <time dateTime={view.receivedAt.toISOString()}>
            <T k="st.received" vars={{ date: local }} />
            {local === utc ? null : <span className={styles.utc}>{utc}</span>}
          </time>
        </li>
        <li>
          <T k="st.version" vars={{ n: String(view.versionNumber) }} />
        </li>
        <li>
          <T k={view.locale === "es" ? "st.sent_es" : "st.sent_en"} />
        </li>
      </ul>
      <ul className={story.storyNav}>
        {view.neighbours.newer === null ? null : (
          <li>
            <a className={ui.button} href={storyPath(form.id, view.neighbours.newer, query)}>
              <T k="st.newer" />
            </a>
          </li>
        )}
        {view.neighbours.older === null ? null : (
          <li>
            <a className={ui.button} href={storyPath(form.id, view.neighbours.older, query)}>
              <T k="st.older" />
            </a>
          </li>
        )}
        <li>
          <a className={ui.button} href={listHref(form.id, query)}>
            <T k="st.back" />
          </a>
        </li>
      </ul>
    </>
  );
}
