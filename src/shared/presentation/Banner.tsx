import type { ReactNode } from "react";
import { cx, styles } from "./styles";

/**
 * A full-width message at the top of a page, not dismissible. Danger is announced as
 * an alert, the other tones as a status. See design-system/components.md, "Alert and
 * banner", and specs/ui-ux/manager.md, "States".
 */
export function Banner(props: {
  tone: "info" | "warning" | "danger";
  children: ReactNode;
  action?: { label: ReactNode; href: string };
}) {
  return (
    <div
      role={props.tone === "danger" ? "alert" : "status"}
      className={cx(styles.banner, styles[props.tone])}
    >
      <div>{props.children}</div>
      {props.action ? (
        <a className={styles.bannerAction} href={props.action.href}>
          {props.action.label}
        </a>
      ) : null}
    </div>
  );
}
