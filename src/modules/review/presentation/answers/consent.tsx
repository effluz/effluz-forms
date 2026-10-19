import { T } from "../copy";
import { styles } from "../styles";
import { NoAnswer } from "./simple";
import type { ReviewDisplay } from "./types";

const consentAnswer = (answer: unknown): { textVersion: string } | null => {
  if (typeof answer !== "object" || answer === null) return null;
  const record = answer as { accepted?: unknown; textVersion?: unknown };
  return record.accepted === true && typeof record.textVersion === "string"
    ? { textVersion: record.textVersion }
    : null;
};

/** Yes, and the version of the consent text the sender accepted (the card adds the time). */
export const consent: ReviewDisplay = {
  Component({ view }) {
    const accepted = consentAnswer(view.answer);
    if (accepted === null) return <NoAnswer />;
    return (
      <>
        <p className={styles.answerText}>
          <T k="st.yes" />
        </p>
        <span className={styles.answerMeta}>{accepted.textVersion}</span>
      </>
    );
  },
};
