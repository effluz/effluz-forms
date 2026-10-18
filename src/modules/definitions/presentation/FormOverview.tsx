import { useId, type ReactNode } from "react";
import type { Languages } from "@/shared/domain/localized-text";
import { Badge } from "@/shared/presentation/Badge";
import { Banner } from "@/shared/presentation/Banner";
import { Bilingual, BilingualText } from "@/shared/presentation/Bilingual";
import { Breadcrumbs, type Crumb } from "@/shared/presentation/Breadcrumbs";
import type { CopyKey } from "@/shared/presentation/copy";
import { Tabs } from "@/shared/presentation/Tabs";
import { cx, styles } from "@/shared/presentation/styles";
import { LIFECYCLE_ACTIONS, type FormOverview as Overview } from "../application";
import { FORMS_PATH } from "./FormsList";
import menu from "./forms.module.css";
import { FormTitle } from "./FormTitle";
import { LifecycleDialog, type OverviewDialog } from "./LifecycleDialog";
import local from "./overview.module.css";
import { formatDate, formHref, lifecycleHref, statusText, statusTone } from "./view-models";

export type { OverviewDialog } from "./LifecycleDialog";

/** The tabs of a form; Submissions is the overview itself. */
export type OverviewTab = "submissions" | "settings" | "share" | "activity";

const OVERVIEW_ERRORS = ["invalid_transition", "slug_mismatch", "not_allowed"] as const;
/** A refusal the lifecycle and delete routes send back to the overview. */
export type OverviewError = (typeof OVERVIEW_ERRORS)[number];

const DIALOGS: readonly OverviewDialog[] = [...LIFECYCLE_ACTIONS, "delete"];

/** The `?action=` query value as a dialog to open, or undefined for anything else. */
export function overviewDialog(value: unknown): OverviewDialog | undefined {
  return DIALOGS.find((dialog) => dialog === value);
}

/** The `?error=` query value as a known refusal, or undefined for anything else. */
export function overviewError(value: unknown): OverviewError | undefined {
  return OVERVIEW_ERRORS.find((error) => error === value);
}

const ERROR_COPY: Record<OverviewError, CopyKey> = {
  invalid_transition: "form.error_transition",
  slug_mismatch: "form.error_slug_mismatch",
  not_allowed: "form.error_not_allowed",
};

const LANGUAGE_COPY: Record<Languages, CopyKey> = {
  bilingual: "new.bilingual",
  en: "new.only_en",
  es: "new.only_es",
};

const TAB_COPY: Record<OverviewTab, CopyKey> = {
  submissions: "form.tab_submissions",
  settings: "form.tab_settings",
  share: "form.tab_share",
  activity: "form.tab_activity",
};

const TABS: readonly OverviewTab[] = ["submissions", "settings", "share", "activity"];

function tabHref(formId: string, tab: OverviewTab): string {
  return tab === "submissions" ? formHref(formId) : formHref(formId, tab);
}

/**
 * A form's page: the breadcrumb, the header with the title, status, public URL,
 * language mode, dates and actions, the lifecycle banners and confirmations, the
 * tabs, and the current tab's body as `children`. Every tab page renders inside
 * it. See specs/ui-ux/manager.md, "Form overview".
 */
export function FormOverview(props: {
  overview: Overview;
  csrfToken: string;
  tab: OverviewTab;
  /** The confirmation asked for with `?action=`; one the form does not allow explains why. */
  dialog?: OverviewDialog;
  /** A refusal sent back by the lifecycle or delete route with `?error=`. */
  error?: OverviewError;
  /** The current tab's body; the Submissions list is not built yet, so its page passes none. */
  children?: ReactNode;
}) {
  const { overview, tab } = props;
  const { form } = overview;
  const dialogAllowed =
    props.dialog === undefined
      ? false
      : props.dialog === "delete"
        ? overview.canDelete
        : overview.allowedActions.includes(props.dialog);
  // An action the form no longer allows reads as the same refusal the route gives:
  // deleting a form that cannot be deleted is `not_allowed`, any other action is
  // `invalid_transition`.
  const refusedDialog: OverviewError | undefined =
    props.dialog === undefined || dialogAllowed
      ? undefined
      : props.dialog === "delete"
        ? "not_allowed"
        : "invalid_transition";
  const error = props.error ?? refusedDialog;

  return (
    <>
      <Breadcrumbs items={crumbs(overview, tab)} />
      <OverviewHeader overview={overview} />
      {error === undefined ? null : (
        <Banner tone="danger">
          <Bilingual k={ERROR_COPY[error]} />
        </Banner>
      )}
      {props.dialog !== undefined && dialogAllowed ? (
        <LifecycleDialog
          formId={form.id}
          action={props.dialog}
          slug={form.slug}
          csrfToken={props.csrfToken}
        />
      ) : null}
      <StatusBanner overview={overview} />
      <OverviewFacts overview={overview} />
      <Tabs
        items={TABS.map((item) => ({
          key: item,
          label: <Bilingual k={TAB_COPY[item]} />,
          href: tabHref(form.id, item),
          current: item === tab,
          // The Submissions list is not built yet, so the tab is shown, not linked.
          disabled: item === "submissions",
        }))}
      />
      {props.children}
    </>
  );
}

function crumbs(overview: Overview, tab: OverviewTab): Crumb[] {
  const { form } = overview;
  const title = <FormTitle title={form.title} slug={form.slug} />;
  const trail: Crumb[] = [{ label: <Bilingual k="nav.forms" />, href: FORMS_PATH }];
  if (tab === "submissions") return [...trail, { label: title }];
  return [
    ...trail,
    { label: title, href: formHref(form.id) },
    { label: <Bilingual k={TAB_COPY[tab]} /> },
  ];
}

function OverviewHeader({ overview }: { overview: Overview }) {
  const { form } = overview;
  // A published badge names its version; a closed or archived one that was published
  // shows it beside the badge, as on the forms list.
  const showVersion = form.status !== "published" && form.currentVersionNumber !== null;
  return (
    <div className={local.header}>
      <div className={local.heading}>
        <h1 className={styles.pageTitle}>
          <FormTitle title={form.title} slug={form.slug} />
        </h1>
        <p className={local.status}>
          <Badge tone={statusTone(form.status)}>
            <BilingualText text={statusText(form.status, form.currentVersionNumber)} />
          </Badge>
          {showVersion ? (
            <span className={local.version}>
              <Bilingual k="home.version" vars={{ n: String(form.currentVersionNumber) }} />
            </span>
          ) : null}
        </p>
      </div>
      <div className={local.headerActions}>
        <a className={styles.primary} href={formHref(form.id, "edit")}>
          <Bilingual k="form.edit" />
        </a>
        <a className={styles.button} href={formHref(form.id, "share")}>
          <Bilingual k="form.share" />
        </a>
        <LifecycleMenu overview={overview} />
      </div>
    </div>
  );
}

/** The allowed lifecycle actions and Delete as a disclosure of links, so it works without JavaScript. */
function LifecycleMenu({ overview }: { overview: Overview }) {
  const { form } = overview;
  const dialogs: OverviewDialog[] = [
    ...overview.allowedActions,
    ...(overview.canDelete ? (["delete"] as const) : []),
  ];
  if (dialogs.length === 0) return null;
  return (
    <details className={menu.menu}>
      <summary className={menu.menuButton}>
        <Bilingual k="home.actions" />
      </summary>
      <ul className={menu.menuList}>
        {dialogs.map((dialog) => (
          <li
            key={dialog}
            className={
              cx(dialog === "delete" && dialogs.length > 1 && menu.menuDivider) || undefined
            }
          >
            <a className={menu.menuLink} href={lifecycleHref(form.id, dialog)}>
              <Bilingual k={`life.${dialog}`} />
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** What the public sees for a closed or archived form, and how to undo it. */
function StatusBanner({ overview }: { overview: Overview }) {
  const { form } = overview;
  const banner =
    form.status === "closed"
      ? { k: "life.banner_closed" as const, undo: "reopen" as const }
      : form.status === "archived"
        ? { k: "life.banner_archived" as const, undo: "unarchive" as const }
        : null;
  if (banner === null) return null;
  const undoable = overview.allowedActions.includes(banner.undo);
  return (
    <Banner
      tone={form.status === "closed" ? "warning" : "info"}
      {...(undoable
        ? {
            action: {
              label: <Bilingual k={`life.${banner.undo}`} />,
              href: lifecycleHref(form.id, banner.undo),
            },
          }
        : {})}
    >
      <Bilingual k={banner.k} />
    </Banner>
  );
}

function OverviewFacts({ overview }: { overview: Overview }) {
  const { form } = overview;
  const id = useId();
  const urlId = `${id}-url`;
  const hintId = `${id}-url-hint`;
  const { opensAt, closesAt, timezone } = form.settings;
  return (
    <div className={local.facts}>
      <div className={cx(styles.field, local.url)}>
        <label htmlFor={urlId} className={styles.label}>
          <Bilingual k="sh.url" />
        </label>
        {/* Without a script there is no Copy button; the hint says to select and copy. */}
        <input
          id={urlId}
          className={styles.input}
          type="url"
          value={overview.publicUrl}
          readOnly
          aria-describedby={hintId}
        />
        <p id={hintId} className={local.hint}>
          <Bilingual k="form.url_hint" />
        </p>
      </div>
      <dl className={local.list}>
        <div>
          <dt>
            <Bilingual k="new.languages" />
          </dt>
          <dd>
            <Bilingual k={LANGUAGE_COPY[form.languages]} />
          </dd>
        </div>
        {opensAt === undefined ? null : (
          <div>
            <dt>
              <Bilingual k="set.opens" />
            </dt>
            <dd>
              <Moment iso={opensAt} timezone={timezone} />
            </dd>
          </div>
        )}
        {closesAt === undefined ? null : (
          <div>
            <dt>
              <Bilingual k="set.closes" />
            </dt>
            <dd>
              <Moment iso={closesAt} timezone={timezone} />
              {overview.closingInDays === null ? null : (
                <strong className={local.closing}>
                  <Bilingual k="form.closing_in" vars={{ n: String(overview.closingInDays) }} />
                </strong>
              )}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/**
 * A date in the form's time zone, named, with the UTC time beside it unless the
 * zone is UTC. See specs/ui-ux/manager.md, "Form overview".
 */
function Moment({ iso, timezone }: { iso: string; timezone: string }) {
  const { local: zoned, utc } = formatDate(iso, timezone);
  return (
    <span className={local.moment}>
      <time dateTime={new Date(iso).toISOString()}>{zoned}</time>
      {zoned === utc ? null : (
        <>
          {" "}
          <span className={local.utc}>{utc}</span>
        </>
      )}
    </span>
  );
}
