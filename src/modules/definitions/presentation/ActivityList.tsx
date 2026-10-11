import type { AuditRecord } from "@/modules/identity/application";
import { definitionsAuditActions, type ActivityFilter } from "../application";
import { Bilingual, BilingualText } from "@/shared/presentation/Bilingual";
import { bothLanguages, copy, type CopyKey, type Text } from "@/shared/presentation/copy";
import { Table, type TableColumn } from "@/shared/presentation/Table";
import { cx, styles } from "@/shared/presentation/styles";
import local from "./tabs.module.css";
import { formatDate, formHref } from "./view-models";

const ACTOR_ID = "activity-actor";
const ACTION_ID = "activity-action";

type DefinitionsAction = (typeof definitionsAuditActions)[number];

/**
 * The query a link to the activity tab carries. `before` and `beforeId` are the ISO instant
 * and the id of the oldest entry shown: together they are the paging cursor.
 */
export interface ActivityQuery {
  actorEmail?: string;
  action?: string;
  before?: string;
  beforeId?: string;
}

/** The activity tab of a form, with the filter and paging in the query string. */
export function activityHref(formId: string, query: ActivityQuery): string {
  const params = new URLSearchParams();
  if (query.actorEmail) params.set("actor", query.actorEmail);
  if (query.action) params.set("action", query.action);
  if (query.before) params.set("before", query.before);
  if (query.before && query.beforeId) params.set("beforeId", query.beforeId);
  const search = params.toString();
  const base = formHref(formId, "activity");
  return search === "" ? base : `${base}?${search}`;
}

function actionKey(action: DefinitionsAction): CopyKey {
  return `au.action_${action}`;
}

/** The plain-words label of a stored action; an action of another module is shown as stored. */
function actionLabel(action: string): Text | string {
  const known = definitionsAuditActions.find((name) => name === action);
  return known === undefined ? action : copy[actionKey(known)];
}

function ActionLabel({ action }: { action: string }) {
  const label = actionLabel(action);
  return typeof label === "string" ? <>{label}</> : <BilingualText text={label} />;
}

const COLUMNS: TableColumn[] = [
  { key: "when", header: <Bilingual k="au.when" /> },
  { key: "actor", header: <Bilingual k="au.actor" /> },
  { key: "action", header: <Bilingual k="au.action" /> },
  { key: "target", header: <Bilingual k="au.target" /> },
];

function detailsText(details: AuditRecord["details"]): string | null {
  if (details === null) return null;
  // Stored as JSON, so a value can be an object or a list despite its declared type.
  const shown = (value: string | number | boolean | object | null): string =>
    typeof value === "object" ? JSON.stringify(value) : String(value);
  const parts = Object.entries(details).map(([key, value]) => `${key}: ${shown(value)}`);
  return parts.length === 0 ? null : parts.join(", ");
}

function cells(entry: AuditRecord, formId: string) {
  const { utc } = formatDate(entry.at, "UTC");
  const details = detailsText(entry.details);
  return [
    <time key="when" className={local.time} dateTime={entry.at.toISOString()}>
      {utc}
    </time>,
    entry.actorEmail === null ? <Bilingual key="actor" k="au.system" /> : entry.actorEmail,
    <ActionLabel key="action" action={entry.action} />,
    <span key="target">
      <a href={formHref(formId)}>
        <Bilingual k="au.target_form" />
      </a>
      {details === null ? null : <span className={local.details}>{details}</span>}
    </span>,
  ];
}

/**
 * The Activity tab body: the audit entries of one form, newest first, with an actor and
 * an action filter that work as a plain GET form. There is no CSV export until the audit
 * page. See specs/ui-ux/manager.md, "Activity tab".
 */
export function ActivityList(props: {
  entries: AuditRecord[];
  actors: string[];
  /** Whether entries older than the last one exist; see `FormActivity.hasMore`. */
  hasMore: boolean;
  filter: ActivityFilter;
  formId: string;
}) {
  const { entries, actors, hasMore, filter, formId } = props;
  const oldest = entries[entries.length - 1];
  // A filter value the menus do not list (an actor no longer in the list, an action of
  // another module) is added, so the select always shows the filter in force.
  const actorOptions =
    filter.actorEmail === undefined || actors.includes(filter.actorEmail)
      ? actors
      : [...actors, filter.actorEmail].sort();
  const extraAction =
    filter.action !== undefined && actionLabel(filter.action) === filter.action
      ? filter.action
      : undefined;
  return (
    <section className={local.tab}>
      <h2 className={local.heading}>
        <Bilingual k="form.tab_activity" />
      </h2>
      <form className={local.filter} method="get" action={formHref(formId, "activity")}>
        <div className={local.filterField}>
          <label htmlFor={ACTOR_ID} className={styles.label}>
            <Bilingual k="au.actor" />
          </label>
          <select
            id={ACTOR_ID}
            className={styles.input}
            name="actor"
            defaultValue={filter.actorEmail ?? ""}
          >
            <option value="">{bothLanguages(copy["au.any_actor"])}</option>
            {actorOptions.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
        </div>
        <div className={local.filterField}>
          <label htmlFor={ACTION_ID} className={styles.label}>
            <Bilingual k="au.action" />
          </label>
          <select
            id={ACTION_ID}
            className={styles.input}
            name="action"
            defaultValue={filter.action ?? ""}
          >
            <option value="">{bothLanguages(copy["au.any_action"])}</option>
            {definitionsAuditActions.map((action) => (
              <option key={action} value={action}>
                {bothLanguages(copy[actionKey(action)])}
              </option>
            ))}
            {extraAction === undefined ? null : <option value={extraAction}>{extraAction}</option>}
          </select>
        </div>
        <button className={styles.button} type="submit">
          <Bilingual k="au.apply" />
        </button>
      </form>
      {entries.length === 0 ? (
        <p className={local.empty}>
          <Bilingual k="au.empty" />
        </p>
      ) : (
        <Table
          caption={<Bilingual k="form.tab_activity" />}
          columns={COLUMNS}
          rows={entries.map((entry) => ({ key: entry.id, cells: cells(entry, formId) }))}
        />
      )}
      {hasMore && oldest !== undefined ? (
        <a
          className={cx(styles.button, local.older)}
          href={activityHref(formId, {
            ...(filter.actorEmail === undefined ? {} : { actorEmail: filter.actorEmail }),
            ...(filter.action === undefined ? {} : { action: filter.action }),
            before: oldest.at.toISOString(),
            beforeId: oldest.id,
          })}
        >
          <Bilingual k="au.older" />
        </a>
      ) : null}
    </section>
  );
}
