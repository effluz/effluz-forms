import { T } from "../copy";
import { styles } from "../styles";
import type { ReviewDisplay } from "./types";

/** The answer to a field that was left empty ("No answer"). */
export function NoAnswer() {
  return (
    <p className={styles.noAnswer}>
      <T k="st.no_answer" />
    </p>
  );
}

/** A value shown as written, with its line breaks kept. */
export function PlainValue({ text }: { text: string }) {
  return <p className={styles.answerText}>{text}</p>;
}

/** The number as stored. */
export const number: ReviewDisplay = {
  Component({ view }) {
    const { answer } = view;
    if (typeof answer === "number" && Number.isFinite(answer)) {
      return <PlainValue text={String(answer)} />;
    }
    return <NoAnswer />;
  },
};

/** The date as stored (`YYYY-MM-DD`). */
export const date: ReviewDisplay = {
  Component({ view }) {
    const { answer } = view;
    return typeof answer === "string" && answer !== "" ? (
      <PlainValue text={answer} />
    ) : (
      <NoAnswer />
    );
  },
};

/** A tick box reads Yes or No; an unticked box is an answer, not a missing one. */
export const checkbox: ReviewDisplay = {
  Component({ view }) {
    const { answer } = view;
    if (typeof answer !== "boolean") return <NoAnswer />;
    return (
      <p className={styles.answerText}>
        <T k={answer ? "st.yes" : "st.no"} />
      </p>
    );
  },
};
