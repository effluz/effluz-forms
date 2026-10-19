import { useId, type ReactElement, type ReactNode } from "react";
import { Badge, type BadgeTone } from "@/shared/presentation/Badge";
import { Banner } from "@/shared/presentation/Banner";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { Breadcrumbs } from "@/shared/presentation/Breadcrumbs";
import { formatDate } from "@/shared/presentation/format-date";
import { styles as ui } from "@/shared/presentation/styles";
import { Table, type TableColumn } from "@/shared/presentation/Table";
import {
  EMPTY_QUERY,
  PLAN_TIME_ZONE,
  DISCARD_REASON_MAX,
  type DeadJobRow,
  type HeartbeatState,
  type OperationsView,
} from "../application";
import { T, type ReviewCopyKey } from "./copy";
import { storyHref } from "./list-view";
import { styles } from "./styles";

const RETRY_PATH = "/admin/operations/retry";
const DISCARD_PATH = "/admin/operations/discard";
const RETRY_TYPE_PATH = "/admin/operations/retry-type";

const HEARTBEAT_LABEL: Record<HeartbeatState, ReviewCopyKey> = {
  ok: "ops.ok",
  warning: "ops.warning",
  critical: "ops.critical",
};

/** The word always shows; the tone only supports it. */
const HEARTBEAT_TONE: Record<HeartbeatState, BadgeTone> = {
  ok: "success",
  warning: "warning",
  critical: "danger",
};

const COLUMNS: TableColumn[] = [
  { key: "type", header: <T k="ops.col_type" /> },
  { key: "story", header: <T k="ops.col_story" /> },
  { key: "attempts", header: <T k="ops.col_attempts" />, align: "end" },
  { key: "error", header: <T k="ops.col_error" /> },
  { key: "first", header: <T k="ops.col_first" /> },
  { key: "last", header: <T k="ops.col_last" /> },
  { key: "actions", header: <Bilingual k="home.actions" />, interactive: true },
];

/** The age of the worker's last heartbeat in words, or "Never" when no worker ever wrote one. */
function HeartbeatAge({ seconds }: { seconds: number | null }): ReactElement {
  if (seconds === null) return <T k="ops.never" />;
  const n = Math.floor(seconds);
  return (
    <T k={n === 1 ? "ops.seconds_ago_one" : "ops.seconds_ago_other"} vars={{ n: String(n) }} />
  );
}

/** A moment in the plan's zone, UTC beneath it when the two differ; the same in both languages. */
function Moment({ at }: { at: Date | null }): ReactElement | null {
  if (at === null) return null;
  const { local, utc } = formatDate(at, PLAN_TIME_ZONE);
  return (
    <time dateTime={at.toISOString()}>
      {local}
      {local === utc ? null : <span className={styles.utc}>{utc}</span>}
    </time>
  );
}

/** One dead job's controls: Retry, and Discard with the reason it needs (1 to 200 characters). */
function RowActions(props: {
  job: DeadJobRow;
  csrfToken: string;
  refused: boolean;
  typeId: string;
  storyId: string;
}): ReactElement {
  const { job } = props;
  const reasonId = useId();
  const describedBy = `${props.typeId} ${props.storyId}`;
  const errorId = useId();
  return (
    <div className={styles.rowActions}>
      <form className={styles.rowForm} method="post" action={RETRY_PATH}>
        <input type="hidden" name="csrf" value={props.csrfToken} />
        <input type="hidden" name="job" value={job.id} />
        <button className={ui.button} type="submit" aria-describedby={describedBy}>
          <T k="ops.retry" />
        </button>
      </form>
      <form className={styles.rowForm} method="post" action={DISCARD_PATH}>
        <input type="hidden" name="csrf" value={props.csrfToken} />
        <input type="hidden" name="job" value={job.id} />
        <label htmlFor={reasonId} className={ui.label}>
          <T k="ops.discard_reason" />
        </label>
        <input
          id={reasonId}
          className={ui.input}
          type="text"
          name="reason"
          required
          pattern="\S.*"
          maxLength={DISCARD_REASON_MAX}
          autoComplete="off"
          {...(props.refused
            ? { "aria-invalid": "true" as const, "aria-describedby": errorId }
            : {})}
        />
        {props.refused ? (
          <p id={errorId} className={styles.fieldError}>
            <T k="ops.err_reason" />
          </p>
        ) : null}
        <button className={ui.button} type="submit" aria-describedby={describedBy}>
          <T k="ops.discard" />
        </button>
      </form>
    </div>
  );
}

/** One dead job as table cells; the type cell's id names the job for its row's buttons. */
function deadJobCells(props: {
  job: DeadJobRow;
  csrfToken: string;
  refused: boolean;
  typeId: string;
  storyId: string;
}): ReactNode[] {
  const { job } = props;
  return [
    <span key="type" id={props.typeId}>
      {job.type}
    </span>,
    job.story === null ? (
      <span key="story" id={props.storyId} className={styles.muted}>
        <T k="ops.no_story" />
      </span>
    ) : (
      <a
        key="story"
        id={props.storyId}
        className={ui.link}
        href={storyHref(job.story.formId, job.story.reference, EMPTY_QUERY)}
      >
        {job.story.reference}
      </a>
    ),
    String(job.attempts),
    job.lastError === null ? (
      <span key="error" className={styles.muted}>
        <Bilingual k="home.none" />
      </span>
    ) : (
      <span key="error" className={styles.errorText}>
        {job.lastError}
      </span>
    ),
    <Moment key="first" at={job.createdAt} />,
    <Moment key="last" at={job.finishedAt} />,
    <RowActions
      key="actions"
      job={job}
      csrfToken={props.csrfToken}
      refused={props.refused}
      typeId={props.typeId}
      storyId={props.storyId}
    />,
  ];
}

function Flash(props: {
  done: "retried" | "retried_all" | "discarded" | null;
  n: number | null;
}): ReactElement | null {
  if (props.done === null) return null;
  if (props.done === "retried") return banner("ops.retried");
  if (props.done === "discarded") return banner("ops.discarded");
  if (props.n === null) return null;
  return banner(props.n === 1 ? "ops.retried_all_one" : "ops.retried_all_other", {
    count: String(props.n),
  });
}

function banner(k: ReviewCopyKey, vars?: Record<string, string>): ReactElement {
  return (
    <Banner tone="success">
      <T k={k} {...(vars === undefined ? {} : { vars })} />
    </Banner>
  );
}

/** The "Retry all" buttons and the table of dead jobs. */
function DeadJobs(props: {
  view: OperationsView;
  csrfToken: string;
  error: "reason_invalid" | null;
  errorJob: string | null;
}): ReactElement {
  const { view } = props;
  const base = useId();
  return (
    <>
      {view.typesWithMany.length === 0 ? null : (
        <div className={styles.bulkActions}>
          {view.typesWithMany.map(({ type, count }) => (
            <form key={type} method="post" action={RETRY_TYPE_PATH}>
              <input type="hidden" name="csrf" value={props.csrfToken} />
              <input type="hidden" name="type" value={type} />
              <button className={ui.button} type="submit">
                <T k="ops.retry_all" vars={{ type, count: String(count) }} />
              </button>
            </form>
          ))}
        </div>
      )}
      <Table
        caption={<T k="ops.dead" />}
        columns={COLUMNS}
        rows={view.dead.map((job, i) => ({
          key: job.id,
          cells: deadJobCells({
            job,
            csrfToken: props.csrfToken,
            refused: props.error === "reason_invalid" && props.errorJob === job.id,
            typeId: `${base}-type-${String(i)}`,
            storyId: `${base}-story-${String(i)}`,
          }),
        }))}
      />
    </>
  );
}

/**
 * The Operations page: the worker's heartbeat in words and status, a banner when no worker
 * runs, and the jobs that stopped retrying, each with Retry and Discard with a reason, plus
 * "Retry all" for a type with more than one. Every change is a plain form post. See
 * specs/ui-ux/manager.md, "Operations page" and specs/use-cases/operate-jobs.md.
 */
export function OperationsPage(props: {
  view: OperationsView;
  csrfToken: string;
  done: "retried" | "retried_all" | "discarded" | null;
  n: number | null;
  error: "reason_invalid" | null;
  errorJob: string | null;
}): ReactElement {
  const { view } = props;
  const heartbeatId = useId();
  const deadId = useId();
  // A refusal for a job that is no longer listed still has to be said somewhere.
  const refusedRowGone =
    props.error === "reason_invalid" && !view.dead.some((job) => job.id === props.errorJob);
  return (
    <>
      <Breadcrumbs items={[{ label: <T k="ops.title" /> }]} />
      <h1 className={ui.pageTitle}>
        <T k="ops.title" />
      </h1>
      <Flash done={props.done} n={props.n} />
      {refusedRowGone ? (
        <Banner tone="danger">
          <T k="ops.err_reason" />
        </Banner>
      ) : null}
      {view.heartbeat === "critical" ? (
        <Banner tone="danger">
          <T k="ops.worker_down" />
        </Banner>
      ) : null}
      <section aria-labelledby={heartbeatId} className={styles.opsCard}>
        <h2 id={heartbeatId}>
          <T k="ops.heartbeat" />
        </h2>
        <p className={styles.heartbeatLine}>
          <HeartbeatAge seconds={view.heartbeatAgeSeconds} />
          <Badge tone={HEARTBEAT_TONE[view.heartbeat]}>
            <T k={HEARTBEAT_LABEL[view.heartbeat]} />
          </Badge>
        </p>
      </section>
      <section aria-labelledby={deadId}>
        <div className={styles.planHeading}>
          <h2 id={deadId}>
            <T k="ops.dead_title" />
          </h2>
        </div>
        {view.dead.length === 0 ? (
          <div className={styles.empty}>
            <p>
              <T k="ops.none_dead" />
            </p>
          </div>
        ) : (
          <DeadJobs
            view={view}
            csrfToken={props.csrfToken}
            error={props.error}
            errorJob={props.errorJob}
          />
        )}
      </section>
    </>
  );
}
