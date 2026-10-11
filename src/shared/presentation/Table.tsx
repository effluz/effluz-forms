import type { ReactNode } from "react";
import { cx, styles } from "./styles";

export type TableColumn = {
  key: string;
  header: ReactNode;
  /** "end" right-aligns the column with tabular numbers, for numeric data. */
  align?: "end";
  /** The column's cells hold their own controls (links, menus, buttons). */
  interactive?: boolean;
};
export type TableRow = { key: string; cells: ReactNode[]; href?: string };

/**
 * A staff data table with a caption and column headers. A row with `href` links its
 * first cell, and that link is stretched over the whole row; cells of a column marked
 * `interactive` sit above it, so their own controls stay clickable. Below 768 px each
 * row stacks as a card that repeats the column headers. See
 * design-system/components.md, "Table (staff)".
 */
export function Table(props: { caption: ReactNode; columns: TableColumn[]; rows: TableRow[] }) {
  const end = (column: TableColumn) => column.align === "end" && styles.end;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption>{props.caption}</caption>
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th scope="col" key={column.key} className={cx(end(column)) || undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.key} className={styles.row}>
              {props.columns.map((column, i) => (
                <td
                  key={column.key}
                  className={
                    cx(end(column), column.interactive && styles.interactiveCell) || undefined
                  }
                >
                  {/* Assistive technology gets the header from the <th>; this is for the stacked view. */}
                  <span aria-hidden="true" className={styles.cellLabel}>
                    {column.header}
                  </span>
                  {i === 0 && row.href !== undefined ? (
                    <a className={styles.rowLink} href={row.href}>
                      {row.cells[i]}
                    </a>
                  ) : (
                    row.cells[i]
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
