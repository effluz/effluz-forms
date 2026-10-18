import { useId, type ReactElement, type ReactNode } from "react";
import { Badge, type BadgeTone } from "@/shared/presentation/Badge";
import { Banner } from "@/shared/presentation/Banner";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { formatDate } from "@/shared/presentation/format-date";
import { cx, styles as ui } from "@/shared/presentation/styles";
import { Table, type TableColumn } from "@/shared/presentation/Table";
import {
  EMPTY_QUERY,
  PLAN_FILTERS,
  REVIEW_STATUSES,
  listQueryString,
  type PlanFilter,
  type ReviewStatus,
  type StoryList,
  type StoryListRow,
} from "../application";
import { T, both, type ReviewCopyKey } from "./copy";
import { ExportDialog } from "./ExportDialog";
import { shortDay } from "./format";
import { chipHref, exportHref, listHref, shareHref, storyHref } from "./list-view";
import { styles } from "./styles";

const STATUS_TONE: Record<ReviewStatus, BadgeTone> = {
  new: "neutral",
  viewed: "neutral",
  edited: "warning",
  published: "success",
};

const STATUS_LABEL: Record<ReviewStatus, ReviewCopyKey> = {
  new: "sub.status_new",
  viewed: "sub.status_viewed",
  edited: "sub.status_edited",
  published: "sub.status_published",
};

const PLAN_LABEL: Record<PlanFilter, ReviewCopyKey> = {
  planned: "sub.plan_planned",
  waiting: "sub.plan_waiting",
  not_ready: "sub.plan_not_ready",
};

const COLUMNS: TableColumn[] = [
  { key: "reference", header: <T k="sub.col_reference" /> },
  { key: "status", header: <T k="sub.col_status" /> },
  { key: "received", header: <T k="sub.col_received" /> },
  { key: "label", header: <T k="sub.col_label" /> },
  { key: "files", header: <T k="sub.col_files" /> },
  { key: "version", header: <T k="sub.col_version" /> },
  { key: "locale", header: <T k="sub.col_locale" /> },
];

/** A group of filter chips: links, the active one marked by `aria-current`, a check and its count. */
function ChipGroup(props: {
  label: ReviewCopyKey;
  chips: { key: string; label: ReviewCopyKey; active: boolean; href: string; count?: number }[];
}): ReactElement {
  const labelId = useId();
  return (
    <nav aria-labelledby={labelId} className={styles.chipGroup}>
      <span id={labelId} className={styles.chipGroupLabel}>
        <T k={props.label} />
      </span>
      <ul className={styles.chips}>
        {props.chips.map((chip) => (
          <li key={chip.key}>
            <a
              className={cx(styles.chip, chip.active && styles.chipActive)}
              href={chip.href}
              {...(chip.active ? { "aria-current": "true" as const } : {})}
            >
              {chip.active ? (
                <span aria-hidden="true" className={styles.chipCheck}>
                  ✓
                </span>
              ) : null}
              <span>
                <T k={chip.label} />
              </span>
              {chip.count === undefined ? null : (
                <span className={styles.chipCount}>{String(chip.count)}</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The filters as a plain GET form to the bare list: the filters in force are its values. */
function FilterForm(props: { list: StoryList }): ReactElement {
  const { ctx, query } = props.list;
  const id = useId();
  return (
    <form className={styles.filter} method="get" action={listHref(ctx.form.id, EMPTY_QUERY)}>
      {query.status === null ? null : <input type="hidden" name="status" value={query.status} />}
      {query.plan === null ? null : <input type="hidden" name="plan" value={query.plan} />}
      <div role="group" aria-labelledby={`${id}-dates`} className={styles.dates}>
        <span id={`${id}-dates`} className={styles.chipGroupLabel}>
          <T k="sub.filter_dates" />
        </span>
        <div className={styles.dateRow}>
          <div className={styles.filterField}>
            <label htmlFor={`${id}-from`} className={ui.label}>
              <T k="sub.filter_from" />
            </label>
            <input
              id={`${id}-from`}
              className={ui.input}
              type="date"
              name="from"
              defaultValue={query.from ?? ""}
            />
          </div>
          <div className={styles.filterField}>
            <label htmlFor={`${id}-to`} className={ui.label}>
              <T k="sub.filter_to" />
            </label>
            <input
              id={`${id}-to`}
              className={ui.input}
              type="date"
              name="to"
              defaultValue={query.to ?? ""}
            />
          </div>
        </div>
      </div>
      <div className={styles.filterField}>
        <label htmlFor={`${id}-version`} className={ui.label}>
          <T k="sub.filter_version" />
        </label>
        <select
          id={`${id}-version`}
          className={ui.input}
          name="version"
          defaultValue={query.version === null ? "" : String(query.version)}
        >
          {/* An <option> holds text only, so both languages are joined into one string. */}
          <option value="">{both("sub.filter_any_version")}</option>
          {ctx.versions.map((version) => (
            <option key={version.id} value={String(version.number)}>
              {both("list.version", { n: String(version.number) })}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.filterField}>
        <label htmlFor={`${id}-q`} className={ui.label}>
          <T k="sub.search" />
        </label>
        <input
          id={`${id}-q`}
          className={ui.input}
          type="search"
          name="q"
          defaultValue={query.q ?? ""}
          autoComplete="off"
        />
      </div>
      <label className={styles.choice}>
        <input type="checkbox" name="media" value="1" defaultChecked={query.media} />
        <span>
          <T k="sub.filter_media" />
        </span>
      </label>
      <button className={ui.button} type="submit">
        <T k="sub.apply" />
      </button>
    </form>
  );
}

function CameraIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={styles.fileIcon}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 6.5h2.5L7 4.5h6l1.5 2H17v9H3z" strokeLinejoin="round" />
      <circle cx="10" cy="11" r="2.75" />
    </svg>
  );
}

function StatusCell(props: { list: StoryList; row: StoryListRow }): ReactElement {
  const { row } = props;
  // A planned story that has not gone out shows its day in place of the status.
  const planned = props.list.ctx.postPlan && row.plannedOn !== null && !row.published;
  return (
    <span className={styles.statusCell}>
      {planned && row.plannedOn !== null ? (
        <span className={styles.planned}>
          <T k="sub.planned_on" vars={{ date: shortDay(row.plannedOn) }} />
        </span>
      ) : (
        <Badge tone={STATUS_TONE[row.status]}>
          <T k={STATUS_LABEL[row.status]} />
        </Badge>
      )}
      {row.deadJobs ? (
        <Badge tone="danger">
          <T k="sub.needs_attention" />
        </Badge>
      ) : null}
    </span>
  );
}

function ReceivedCell(props: { row: StoryListRow; timezone: string }): ReactElement {
  const { local, utc } = formatDate(props.row.receivedAt, props.timezone);
  return (
    <time dateTime={props.row.receivedAt.toISOString()} className={styles.received}>
      {local}
      {local === utc ? null : <span className={styles.utc}>{utc}</span>}
    </time>
  );
}

function rowCells(list: StoryList, row: StoryListRow): ReactNode[] {
  return [
    row.reference,
    <StatusCell key="status" list={list} row={row} />,
    <ReceivedCell key="received" row={row} timezone={list.ctx.form.settings.timezone} />,
    row.label === null ? (
      <span key="label" className={styles.muted}>
        <T k="st.no_answer" />
      </span>
    ) : (
      row.label
    ),
    <span key="files" className={styles.files}>
      {row.mediaCount > 0 ? <CameraIcon /> : null}
      <T
        k={row.mediaCount === 1 ? "list.files_one" : "list.files_other"}
        vars={{ n: String(row.mediaCount) }}
      />
    </span>,
    <T key="version" k="list.version" vars={{ n: String(row.versionNumber) }} />,
    row.locale.toUpperCase(),
  ];
}

function Empty(props: { list: StoryList; publicUrl: string }): ReactElement {
  const { list } = props;
  const filtered = listQueryString({ ...list.query, page: 1 }) !== "";
  if (filtered || list.total > 0) {
    return (
      <div className={styles.empty}>
        <p>
          <T k="sub.empty_filtered" />
        </p>
        <a className={ui.button} href={listHref(list.ctx.form.id, EMPTY_QUERY)}>
          <T k="sub.clear_filters" />
        </a>
      </div>
    );
  }
  return (
    <div className={styles.empty}>
      <p>
        <T k="sub.empty" />
      </p>
      <p className={styles.emptyLinks}>
        <a className={ui.link} href={props.publicUrl} target="_blank" rel="noopener">
          {props.publicUrl}
        </a>
        <a className={ui.button} href={shareHref(list.ctx.form.id)}>
          <Bilingual k="form.share" />
        </a>
      </p>
    </div>
  );
}

function Pager(props: { list: StoryList }): ReactElement {
  const { ctx, query, pageCount } = props.list;
  const statusId = useId();
  const to = (page: number) => listHref(ctx.form.id, { ...query, page });
  return (
    <nav aria-labelledby={statusId} className={styles.pager}>
      <p id={statusId} className={styles.pageStatus}>
        <T k="sub.page" vars={{ n: String(query.page), total: String(pageCount) }} />
      </p>
      <ul className={styles.pagerLinks}>
        {query.page > 1 ? (
          <li>
            <a className={ui.button} href={to(query.page - 1)}>
              <T k="sub.newer_page" />
            </a>
          </li>
        ) : null}
        {query.page < pageCount ? (
          <li>
            <a className={ui.button} href={to(query.page + 1)}>
              <T k="sub.older_page" />
            </a>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

/**
 * The Submissions tab body: the status and post-plan chips, the filters as a GET form, one
 * table of the page's stories (each row a plain link to its story page, which keeps the list's
 * query), the pager and, opened by `?export=1`, the export dialog. Links are plain `<a>`, never
 * `next/link`: a prefetched story page would record a view. See specs/ui-ux/manager.md,
 * "Submissions tab".
 */
export function SubmissionsList(props: {
  list: StoryList;
  publicUrl: string;
  csrfToken: string;
  exportOpen: boolean;
  exportError: "too_large" | null;
  deleted: string | null;
}): ReactElement {
  const { list } = props;
  const { ctx, query, rows, total, counts } = list;
  const formId = ctx.form.id;
  return (
    <section className={styles.list}>
      {props.deleted === null ? null : (
        <Banner tone="success">
          <T k="sub.deleted" vars={{ ref: props.deleted }} />
        </Banner>
      )}
      <div className={styles.toolbar}>
        <h2 className={styles.heading}>
          <Bilingual k="form.tab_submissions" />
        </h2>
        <p className={styles.total}>
          <T
            k={total === 1 ? "sub.count_one" : "sub.count_other"}
            vars={{ count: String(total) }}
          />
        </p>
        <a className={ui.button} href={exportHref(formId, query)}>
          <T k="sub.export" />
        </a>
      </div>
      {props.exportOpen ? (
        <ExportDialog
          formId={formId}
          query={query}
          total={total}
          csrfToken={props.csrfToken}
          error={props.exportError}
        />
      ) : null}
      <ChipGroup
        label="sub.filter_status"
        chips={REVIEW_STATUSES.map((status) => ({
          key: status,
          label: STATUS_LABEL[status],
          active: query.status === status,
          href: chipHref(formId, query, { status }),
          count: counts[status],
        }))}
      />
      {ctx.postPlan ? (
        <ChipGroup
          label="sub.filter_plan"
          chips={PLAN_FILTERS.map((plan) => ({
            key: plan,
            label: PLAN_LABEL[plan],
            active: query.plan === plan,
            href: chipHref(formId, query, { plan }),
          }))}
        />
      ) : null}
      <FilterForm list={list} />
      {rows.length === 0 ? (
        <Empty list={list} publicUrl={props.publicUrl} />
      ) : (
        <Table
          caption={<T k="sub.caption" />}
          columns={COLUMNS}
          rows={rows.map((row) => ({
            key: row.reference,
            cells: rowCells(list, row),
            href: storyHref(formId, row.reference, query),
          }))}
        />
      )}
      {list.pageCount > 1 || query.page > 1 ? <Pager list={list} /> : null}
    </section>
  );
}
