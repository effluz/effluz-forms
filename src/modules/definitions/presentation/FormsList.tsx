import type { FormListRow, FormTab } from "../application";
import { Badge } from "@/shared/presentation/Badge";
import { Bilingual, BilingualText } from "@/shared/presentation/Bilingual";
import type { CopyKey } from "@/shared/presentation/copy";
import { Table, type TableColumn } from "@/shared/presentation/Table";
import { Tabs } from "@/shared/presentation/Tabs";
import { cx, styles } from "@/shared/presentation/styles";
import local from "./forms.module.css";
import { FormTitle } from "./FormTitle";
import {
  allowedActions,
  formatDate,
  formHref,
  lifecycleHref,
  statusText,
  statusTone,
  titleText,
} from "./view-models";

export const FORMS_PATH = "/admin/forms";
export const NEW_FORM_PATH = "/admin/forms/new";
const TABS: readonly FormTab[] = ["active", "closed", "archived"];
const SEARCH_ID = "forms-search";

export function tabHref(tab: FormTab): string {
  return tab === "active" ? FORMS_PATH : `${FORMS_PATH}?tab=${tab}`;
}

/**
 * The manager's home: the forms of one tab with what is new, the tab counts,
 * search and the New form button. See specs/ui-ux/manager.md, "Forms list (home)".
 */
export function FormsList(props: {
  tab: FormTab;
  counts: Record<FormTab, number>;
  rows: FormListRow[];
  search: string;
}) {
  const installationEmpty = TABS.every((tab) => props.counts[tab] === 0);
  return (
    <>
      <div className={local.pageHeader}>
        <h1 className={styles.pageTitle}>
          <Bilingual k="nav.forms" />
        </h1>
        {installationEmpty ? null : <NewFormButton />}
      </div>
      {installationEmpty ? (
        <div className={local.empty}>
          <p>
            <Bilingual k="home.empty" />
          </p>
          <p>
            <NewFormButton />
          </p>
        </div>
      ) : (
        <>
          <Tabs
            items={TABS.map((tab) => ({
              key: tab,
              label: <Bilingual k={`home.${tab}`} />,
              href: tabHref(tab),
              count: props.counts[tab],
              current: tab === props.tab,
            }))}
          />
          <SearchForm tab={props.tab} search={props.search} />
          {props.rows.length === 0 ? (
            <div className={local.empty}>
              <p>
                <Bilingual k="home.none_here" />
              </p>
            </div>
          ) : (
            <Table
              caption={<Bilingual k={`home.${props.tab}`} />}
              columns={COLUMNS}
              rows={props.rows.map((row) => ({
                key: row.id,
                href: formHref(row.id),
                cells: cells(row),
              }))}
            />
          )}
        </>
      )}
    </>
  );
}

function NewFormButton() {
  return (
    <a className={styles.primary} href={NEW_FORM_PATH}>
      <Bilingual k="home.new_form" />
    </a>
  );
}

/** A plain GET form, so search works without JavaScript and the URL can be shared. */
function SearchForm({ tab, search }: { tab: FormTab; search: string }) {
  return (
    <form className={local.search} role="search" method="get" action={FORMS_PATH}>
      {tab === "active" ? null : <input type="hidden" name="tab" value={tab} />}
      <div className={local.searchField}>
        <label htmlFor={SEARCH_ID} className={styles.label}>
          <Bilingual k="home.search" />
        </label>
        <input
          id={SEARCH_ID}
          className={styles.input}
          type="search"
          name="q"
          defaultValue={search}
          autoComplete="off"
        />
      </div>
      <button className={styles.button} type="submit">
        <Bilingual k="home.search_submit" />
      </button>
    </form>
  );
}

const COLUMNS: TableColumn[] = [
  { key: "title", header: <Bilingual k="home.col_title" /> },
  { key: "status", header: <Bilingual k="home.col_status" /> },
  { key: "new", header: <Bilingual k="home.col_new" />, align: "end" },
  { key: "total", header: <Bilingual k="home.col_total" />, align: "end" },
  { key: "last", header: <Bilingual k="home.col_last" /> },
  { key: "closes", header: <Bilingual k="home.col_closes" /> },
  { key: "actions", header: <Bilingual k="home.actions" />, interactive: true },
];

function cells(row: FormListRow) {
  return [
    <span key="title" className={local.title}>
      <FormTitle title={row.title} slug={row.slug} />
    </span>,
    <StatusCell key="status" row={row} />,
    row.newCount > 0 ? (
      <strong key="new" className={local.newCount}>
        {row.newCount}
      </strong>
    ) : (
      row.newCount
    ),
    row.total,
    <Moment key="last" at={row.lastReceivedAt} timezone={row.timezone} />,
    <Moment key="closes" at={row.closesAt} timezone={row.timezone} />,
    <ActionsMenu key="actions" row={row} />,
  ];
}

function StatusCell({ row }: { row: FormListRow }) {
  // A published badge names its version itself; a closed or archived form that was
  // published shows the version beside its badge.
  const showVersion = row.status !== "published" && row.versionNumber !== null;
  return (
    <>
      <Badge tone={statusTone(row.status)}>
        <BilingualText text={statusText(row.status, row.versionNumber)} />
      </Badge>
      {showVersion ? (
        <span className={local.version}>
          <Bilingual k="home.version" vars={{ n: String(row.versionNumber) }} />
        </span>
      ) : null}
    </>
  );
}

/**
 * A moment in the form's own zone, labelled with it, with UTC on a second line;
 * a missing one reads "None" to assistive technology. See specs/ui-ux/manager.md,
 * "Forms list (home)".
 */
function Moment({ at, timezone }: { at: Date | string | null; timezone: string }) {
  if (at === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className={local.visuallyHidden}>
          <Bilingual k="home.none" />
        </span>
      </>
    );
  }
  const date = typeof at === "string" ? new Date(at) : at;
  const { local: zoned, utc } = formatDate(date, timezone);
  return (
    <time className={local.time} dateTime={date.toISOString()}>
      {zoned}
      {zoned === utc ? null : <span className={local.utc}>{utc}</span>}
    </time>
  );
}

/**
 * The row's actions as a disclosure of links, so it works without JavaScript. Its
 * summary carries the form's title for assistive technology, since every row has one.
 */
function ActionsMenu({ row }: { row: FormListRow }) {
  const actions = allowedActions(row.status, row.versionNumber);
  return (
    <details className={local.menu}>
      <summary className={local.menuButton}>
        <Bilingual k="home.actions" />
        <span className={local.visuallyHidden}>{titleText(row.title, row.slug)}</span>
      </summary>
      <ul className={local.menuList}>
        <MenuLink href={formHref(row.id)} k="home.open" />
        <MenuLink href={formHref(row.id, "edit")} k="form.edit" />
        <MenuLink href={formHref(row.id, "share")} k="form.share" />
        <MenuLink href={formHref(row.id, "settings")} k="form.tab_settings" />
        {actions.map((action, i) => (
          <MenuLink
            key={action}
            href={lifecycleHref(row.id, action)}
            k={`life.${action}`}
            divided={i === 0}
          />
        ))}
      </ul>
    </details>
  );
}

function MenuLink(props: { href: string; k: CopyKey; divided?: boolean }) {
  return (
    <li className={cx(props.divided && local.menuDivider) || undefined}>
      <a className={local.menuLink} href={props.href}>
        <Bilingual k={props.k} />
      </a>
    </li>
  );
}
