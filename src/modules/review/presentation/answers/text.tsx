import type { AnswerView } from "../../application";
import { NoAnswer, PlainValue } from "./simple";
import type { ReviewDisplay } from "./types";

/** The corrected text when staff corrected it, else the sender's text. */
function textOf(view: AnswerView): string | null {
  const text = view.corrected?.text ?? view.answer;
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

const textDisplay: ReviewDisplay = {
  Component({ view }) {
    const text = textOf(view);
    return text === null ? <NoAnswer /> : <PlainValue text={text} />;
  },
};

// One display serves the four text types; each is still registered under its own id.
export const short_text: ReviewDisplay = textDisplay;
export const long_text: ReviewDisplay = textDisplay;
export const email: ReviewDisplay = textDisplay;
export const phone: ReviewDisplay = textDisplay;
