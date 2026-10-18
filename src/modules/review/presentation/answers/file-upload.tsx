import { T } from "../copy";
import { styles } from "../styles";
import { NoAnswer } from "./simple";
import type { ReviewDisplay } from "./types";

/**
 * The number of files, with a link to the Photos and videos card (`id="photos"`), where the
 * files themselves are shown: the answers card never shows a file.
 */
export const file_upload: ReviewDisplay = {
  Component({ view }) {
    const count = Array.isArray(view.answer) ? view.answer.length : 0;
    if (count === 0) return <NoAnswer />;
    return (
      <p className={styles.answerText}>
        <a href="#photos">
          <T
            k={count === 1 ? "st.files_below_one" : "st.files_below_other"}
            vars={{ n: String(count) }}
          />
        </a>
      </p>
    );
  },
};
