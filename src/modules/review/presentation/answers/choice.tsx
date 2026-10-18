import { z } from "zod";
import { optionSchema } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import { BilingualText } from "@/shared/presentation/Bilingual";
import type { AnswerView } from "../../application";
import { styles } from "../styles";
import { NoAnswer } from "./simple";
import type { ReviewDisplay } from "./types";

const optionsOf = z.object({ options: z.array(optionSchema) });

/**
 * A chosen option by its label in both languages, resolved per language so a single-language
 * form shows its one label once. A key the version does not list shows as the key itself.
 */
function Choice({ view, optionKey }: { view: AnswerView; optionKey: string }) {
  const parsed = optionsOf.safeParse(view.field.settings);
  const option = parsed.success ? parsed.data.options.find((o) => o.key === optionKey) : undefined;
  if (option === undefined) return <>{optionKey}</>;
  const text = {
    en: resolveText(option.label, "en", view.languages),
    es: resolveText(option.label, "es", view.languages),
  };
  return <BilingualText text={text} />;
}

export const single_choice: ReviewDisplay = {
  Component({ view }) {
    const { answer } = view;
    if (typeof answer !== "string" || answer === "") return <NoAnswer />;
    return (
      <p className={styles.answerText}>
        <Choice view={view} optionKey={answer} />
      </p>
    );
  },
};

export const multiple_choice: ReviewDisplay = {
  Component({ view }) {
    const keys = Array.isArray(view.answer)
      ? view.answer.filter((key): key is string => typeof key === "string")
      : [];
    if (keys.length === 0) return <NoAnswer />;
    return (
      <ul className={styles.answerList}>
        {keys.map((key) => (
          <li key={key}>
            <Choice view={view} optionKey={key} />
          </li>
        ))}
      </ul>
    );
  },
};
