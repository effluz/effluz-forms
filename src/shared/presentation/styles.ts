/// <reference types="next" />
// Next's types declare `*.module.css`; next-env.d.ts is generated and ignored, so the
// reference keeps typecheck working before a build has written it.
import styles from "./manager.module.css";

/** The manager's class names, also for pages that lay out content in the shell's tiers. */
export { styles };

/** Joins class names, skipping absent ones. */
export function cx(...names: (string | undefined | false)[]): string {
  return names.filter(Boolean).join(" ");
}
