import { useId, type ReactElement } from "react";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { cx, styles as ui } from "@/shared/presentation/styles";
import { EXPORT_ROW_CAP } from "../domain/csv";
import type { ListQuery } from "../application";
import { T, type ReviewCopyKey } from "./copy";
import { listHref } from "./list-view";
import { styles } from "./styles";

/** The filters the export carries, as hidden fields: the query without its page. */
function filterFields(query: ListQuery): [name: string, value: string][] {
  const fields: [string, string | null][] = [
    ["status", query.status],
    ["plan", query.plan],
    ["from", query.from],
    ["to", query.to],
    ["version", query.version === null ? null : String(query.version)],
    ["media", query.media ? "1" : null],
    ["q", query.q],
  ];
  return fields.flatMap(([name, value]) => (value === null ? [] : [[name, value]]));
}

function Radio(props: { name: string; value: string; label: ReviewCopyKey; checked?: boolean }) {
  return (
    <label className={styles.choice}>
      <input type="radio" name={props.name} value={props.value} defaultChecked={props.checked} />
      <span>
        <T k={props.label} />
      </span>
    </label>
  );
}

/**
 * The export dialog: an in-page section (no JavaScript) with the scope, the options and the
 * notice. It posts to the export route, which streams the CSV. Above `EXPORT_ROW_CAP` rows,
 * or when the route has just refused, it asks to narrow the filters and offers no download. The
 * Export link ends in `#export`, so the page lands on it; `tabIndex={-1}` lets that take focus.
 * See specs/ui-ux/manager.md, "Export dialog".
 */
export function ExportDialog(props: {
  formId: string;
  query: ListQuery;
  total: number;
  csrfToken: string;
  error: "too_large" | null;
}): ReactElement {
  const id = useId();
  const titleId = `${id}-title`;
  const scopeId = `${id}-scope`;
  const { formId, query, total } = props;
  const tooLarge = total > EXPORT_ROW_CAP || props.error === "too_large";
  const close = (
    <a className={ui.button} href={listHref(formId, query)}>
      <Bilingual k="shell.cancel" />
    </a>
  );
  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={scopeId}
      className={ui.dialog}
      id="export"
      tabIndex={-1}
    >
      <h2 id={titleId} className={ui.dialogTitle}>
        <T k="ex.title" />
      </h2>
      <p id={scopeId} className={ui.dialogBody}>
        <T k={total === 1 ? "ex.scope_one" : "ex.scope_other"} vars={{ count: String(total) }} />
      </p>
      {tooLarge ? (
        <>
          <p role="alert" className={styles.refusal}>
            <T k="ex.too_large" />
          </p>
          <div className={ui.actions}>{close}</div>
        </>
      ) : (
        <form
          className={ui.dialogForm}
          method="post"
          action={`/admin/forms/${encodeURIComponent(formId)}/export`}
        >
          <input type="hidden" name="csrf" value={props.csrfToken} />
          {filterFields(query).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>
              <T k="ex.versions" />
            </legend>
            <Radio name="versions" value="filter" label="ex.versions_filter" checked />
            <Radio name="versions" value="all" label="ex.versions_all" />
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>
              <T k="ex.text" />
            </legend>
            <Radio name="text" value="original" label="ex.text_original" checked />
            <Radio name="text" value="corrected" label="ex.text_curated" />
            <Radio name="text" value="both" label="ex.text_both" />
          </fieldset>
          <label className={cx(styles.choice, styles.exportPaths)}>
            <input type="checkbox" name="paths" value="1" />
            <span>
              <T k="ex.media_paths" />
            </span>
          </label>
          <p className={styles.notice}>
            <T k="ex.notice" />
          </p>
          <div className={ui.actions}>
            {close}
            <button className={ui.primary} type="submit">
              <T k="ex.download" />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
