import { z } from "zod";
import { localizedTextSchema, resolveText } from "@/shared/domain/localized-text";
import { BilingualText } from "@/shared/presentation/Bilingual";
import { styles } from "../styles";
import type { ReviewDisplay } from "./types";

const settingsOf = z.object({ title: localizedTextSchema });

/**
 * A section holds no answer; it shows its title as a heading. The story page lists input
 * fields only, so this serves the rule that every registered type has a display.
 */
export const section: ReviewDisplay = {
  Component({ view }) {
    const parsed = settingsOf.safeParse(view.field.settings);
    if (!parsed.success) return null;
    const { title } = parsed.data;
    const text = {
      en: resolveText(title, "en", view.languages),
      es: resolveText(title, "es", view.languages),
    };
    return (
      <h3 className={styles.answerHeading}>
        <BilingualText text={text} />
      </h3>
    );
  },
};
