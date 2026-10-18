import type { ReactElement } from "react";
import type { AnswerView } from "../../application";

/**
 * How one field type's answer is shown on the story page: the value only. The label, the
 * Edited tag and the Edit and Compare actions belong to the answers card. Registered per
 * field type in `./index.ts`, which a conformance test checks against the form model's types.
 */
export interface ReviewDisplay {
  Component: (props: { view: AnswerView }) => ReactElement | null;
}
