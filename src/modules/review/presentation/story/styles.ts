/// <reference types="next" />
// Next's types declare `*.module.css`; next-env.d.ts is generated and ignored, so the
// reference keeps typecheck working before a build has written it.
import styles from "./story.module.css";

/** The story page's class names; the answers' and tiles' are in `../styles`. */
export { styles as story };
