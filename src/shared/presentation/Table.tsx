import type { ReactNode } from "react";
import { styles } from "./styles";

export type TableColumn = { key: string; header: ReactNode };
export type TableRow = { key: string; cells: ReactNode[]; href?: string };

/**
 * A staff data table with a caption and column headers. A row with `href` links its
 * first cell, and the link covers the whole row. Below 768 px each row stacks as a
 * card that repeats the column headers. See design-system/components.md,
 * "Table (staff)".
 */
export function Table(props: { caption: ReactNode; columns: TableColumn[]; rows: TableRow[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption>{props.caption}</caption>
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th scope="col" key={column.key}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.key} className={styles.row}>
              {props.columns.map((column, i) => (
                <td key={column.key}>
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
