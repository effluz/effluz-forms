import type { ReactNode } from "react";
import { cx, styles } from "./styles";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * A status label. It always carries text, so the tone is never the only signal.
 * See design-system/components.md, "Badge".
 */
export function Badge(props: { tone: BadgeTone; children: ReactNode }) {
  return <span className={cx(styles.badge, styles[props.tone])}>{props.children}</span>;
}
