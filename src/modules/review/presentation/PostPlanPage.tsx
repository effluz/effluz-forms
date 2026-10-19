import { useId, type ReactElement } from "react";
import type { LocalizedText } from "@/shared/domain/localized-text";
import { Badge } from "@/shared/presentation/Badge";
import { BilingualText } from "@/shared/presentation/Bilingual";
import { Breadcrumbs } from "@/shared/presentation/Breadcrumbs";
import { cx, styles as ui } from "@/shared/presentation/styles";
import {
  EMPTY_QUERY,
  type DayView,
  type IsoDate,
  type PlanItem,
  type WeekView,
} from "../application";
import { T } from "./copy";
import { dayText } from "./format";
import { OutwardIcon, StateIcon } from "./icons";
import { storyHref } from "./list-view";
import { styles } from "./styles";

/** The Post plan page; the week's links keep the current page and only change `?week=`. */
const PLAN_PATH = "/admin/plan";

const planHref = (week: IsoDate | null, pick: IsoDate | null = null): string => {
  const query = [
    week === null ? null : `week=${week}`,
    pick === null ? null : `pick=${pick}`,
  ].filter((part) => part !== null);
  return query.length === 0 ? PLAN_PATH : `${PLAN_PATH}?${query.join("&")}`;
};

/** A form's staff-authored title as text: both languages when it has both, else the one it has. */
function FormName({ title }: { title: LocalizedText }): ReactElement {
  const en = title.en?.trim() ?? "";
  const es = title.es?.trim() ?? "";
  if (en !== "" && es !== "") return <BilingualText text={{ en, es }} />;
  if (es !== "") return <span lang="es">{es}</span>;
  return <>{en}</>;
}

/**
 * The three checks as words with an icon: the icon and "Done" or "Missing" carry the state, the
 * colour only supports it. The words sit inside the element that carries the colour, so the
 * today row can set them to the default text colour (design-system/components.md, "Readiness
 * checks").
 */
function Checks({ item }: { item: PlanItem }): ReactElement {
  const { readiness } = item;
  const checks = [
    { key: "chosen", name: "st.check_chosen", done: readiness.photosChosen },
    { key: "edited", name: "st.check_edited", done: readiness.photosEdited },
    { key: "text", name: "st.check_text", done: readiness.textChecked },
  ] as const;
  return (
    <>
      <p className={styles.checkSummary}>
        {readiness.ready ? (
          <T k="st.ready" />
        ) : (
          <T k="st.not_ready" vars={{ n: String(readiness.done) }} />
        )}
      </p>
      <ul className={styles.checks}>
        {checks.map((check) => (
          <li
            key={check.key}
            className={cx(styles.check, check.done ? styles.checkDone : styles.checkMissing)}
          >
            <StateIcon done={check.done} />
            <span className={styles.checkWords}>
              <T k={check.name} />
            </span>{" "}
            <span className={styles.checkWords}>
              <T k={check.done ? "st.check_done" : "st.check_missing"} />
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A story's reference (a link to its page), its label and its form. */
function StoryHead({ item, refId }: { item: PlanItem; refId: string }): ReactElement {
  return (
    <>
      <p className={styles.storyHead}>
        <a
          id={refId}
          className={cx(ui.link, styles.dayLink, styles.storyRef)}
          href={storyHref(item.formId, item.reference, EMPTY_QUERY)}
        >
          {item.reference}
        </a>
        <span>{item.label === null ? <T k="st.no_answer" /> : item.label}</span>
      </p>
      <p className={styles.storyForm}>
        <FormName title={item.formTitle} />
      </p>
    </>
  );
}

function PlannedStory({ item }: { item: PlanItem }): ReactElement {
  const refId = useId();
  return (
    <div className={styles.planStory}>
      <StoryHead item={item} refId={refId} />
      <Checks item={item} />
    </div>
  );
}

function PublishedStory({ item }: { item: PlanItem }): ReactElement {
  return (
    <li className={styles.publishedItem}>
      <Badge tone="success">
        <T k="plan.published" />
      </Badge>
      <a
        className={cx(ui.link, styles.dayLink)}
        href={storyHref(item.formId, item.reference, EMPTY_QUERY)}
      >
        {item.reference}
      </a>
      {item.label === null ? null : <span>{item.label}</span>}
      {item.postUrl === null ? null : (
        <a className={cx(ui.link, styles.dayLink)} href={item.postUrl} rel="noopener">
          <T k="st.open_post" />
          <OutwardIcon />
        </a>
      )}
    </li>
  );
}

/** One day: its weekday and date on the left, its stories or its empty slot on the right. */
function DayRow({ day, monday }: { day: DayView; monday: IsoDate }): ReactElement {
  const empty = day.planned === null && day.published.length === 0;
  const dateId = useId();
  return (
    <li
      data-day={day.date}
      className={cx(styles.weekRow, day.isToday && styles.weekToday)}
      {...(day.isToday ? { "aria-current": "date" as const } : {})}
    >
      <div className={styles.weekDay}>
        <h2 className={styles.weekDate}>
          <time id={dateId} dateTime={day.date}>
            <BilingualText text={dayText(day.date)} />
          </time>
        </h2>
        {day.isToday ? (
          <span className={styles.todayMark}>
            <T k="plan.today" />
          </span>
        ) : null}
      </div>
      <div className={styles.weekContent}>
        {day.planned === null ? null : <PlannedStory item={day.planned} />}
        {day.published.length === 0 ? null : (
          <ul className={styles.publishedList}>
            {day.published.map((item) => (
              <PublishedStory key={item.reference} item={item} />
            ))}
          </ul>
        )}
        {!empty ? null : day.isPast ? (
          <p className={styles.emptyDay}>
            <T k="plan.nothing" />
          </p>
        ) : (
          <p className={styles.emptyDay}>
            <a className={ui.button} href={planHref(monday, day.date)} aria-describedby={dateId}>
              <T k="plan.pick" />
            </a>
          </p>
        )}
      </div>
    </li>
  );
}

function WeekNav({ week }: { week: WeekView }): ReactElement {
  const titleId = useId();
  return (
    <nav aria-labelledby={titleId} className={styles.weekNav}>
      <p id={titleId} className={styles.weekTitle}>
        <T k="plan.week_of" vars={{ date: week.monday }} />
      </p>
      <ul className={styles.pagerLinks}>
        <li>
          <a className={ui.button} href={planHref(week.previous)}>
            <T k="plan.previous" />
          </a>
        </li>
        <li>
          <a className={ui.button} href={planHref(null)}>
            <T k="plan.this_week" />
          </a>
        </li>
        <li>
          <a className={ui.button} href={planHref(week.next)}>
            <T k="plan.next" />
          </a>
        </li>
      </ul>
    </nav>
  );
}

/** A story waiting for a date; with a picked day it offers to plan the story for it. */
function WaitingRow(props: {
  item: PlanItem;
  pick: IsoDate | null;
  monday: IsoDate;
  csrfToken: string;
}): ReactElement {
  const { item, pick } = props;
  const refId = useId();
  return (
    <li className={styles.weekRow}>
      <div className={styles.weekContent}>
        <div className={styles.planStory}>
          <StoryHead item={item} refId={refId} />
          <Checks item={item} />
        </div>
      </div>
      {pick === null ? null : (
        <form
          className={styles.rowForm}
          method="post"
          action={`${storyHref(item.formId, item.reference, EMPTY_QUERY)}/plan`}
        >
          <input type="hidden" name="csrf" value={props.csrfToken} />
          <input type="hidden" name="date" value={pick} />
          <input type="hidden" name="return" value="plan" />
          <input type="hidden" name="week" value={props.monday} />
          <button className={ui.button} type="submit" aria-describedby={refId}>
            <T k="plan.plan_for" vars={{ date: pick }} />
          </button>
        </form>
      )}
    </li>
  );
}

function Waiting(props: {
  waiting: { rows: PlanItem[]; total: number };
  pick: IsoDate | null;
  monday: IsoDate;
  csrfToken: string;
}): ReactElement {
  const headingId = useId();
  const { rows, total } = props.waiting;
  return (
    <section aria-labelledby={headingId} className={styles.planSection}>
      {props.pick === null ? null : (
        <p className={styles.pickNotice}>
          <T k="plan.picking" vars={{ date: props.pick }} />
        </p>
      )}
      <div className={styles.planHeading}>
        <h2 id={headingId}>
          <T k="plan.waiting" />
        </h2>
        <p className={styles.total}>
          <T
            k={total === 1 ? "plan.waiting_count_one" : "plan.waiting_count_other"}
            vars={{ count: String(total) }}
          />
        </p>
      </div>
      {rows.length === 0 ? (
        <div className={styles.empty}>
          <p>
            <T k="plan.waiting_empty" />
          </p>
        </div>
      ) : (
        <ul className={styles.weekList}>
          {rows.map((item) => (
            <WaitingRow
              key={`${item.formId}/${item.reference}`}
              item={item}
              pick={props.pick}
              monday={props.monday}
              csrfToken={props.csrfToken}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The Post plan: a breadcrumb, the week's navigation, seven day rows and the stories waiting for
 * a date, with the plan buttons when a day is picked (`?pick=`). Links are plain `<a>`, never
 * `next/link`, and every change is a plain form post, so it all works without JavaScript. Opening
 * the page is audited by `postPlanWeek`, which the page calls once per load. See
 * specs/ui-ux/manager.md, "Post plan page".
 */
export function PostPlanPage(props: {
  week: WeekView;
  waiting: { rows: PlanItem[]; total: number };
  pick: IsoDate | null;
  csrfToken: string;
}): ReactElement {
  const { week } = props;
  return (
    <>
      <Breadcrumbs items={[{ label: <T k="plan.title" /> }]} />
      <h1 className={ui.pageTitle}>
        <T k="plan.title" />
      </h1>
      {week.formsInPlan === 0 ? (
        <div className={styles.empty}>
          <p>
            <T k="plan.no_forms" />
          </p>
        </div>
      ) : (
        <>
          <WeekNav week={week} />
          <ul className={styles.weekList}>
            {week.days.map((day) => (
              <DayRow key={day.date} day={day} monday={week.monday} />
            ))}
          </ul>
          <Waiting
            waiting={props.waiting}
            pick={props.pick}
            monday={week.monday}
            csrfToken={props.csrfToken}
          />
        </>
      )}
    </>
  );
}
