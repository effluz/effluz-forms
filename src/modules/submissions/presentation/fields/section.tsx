import { fieldTypes } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import { RichText } from "@/shared/presentation/RichText";
import { styles } from "../styles";
import type { FieldRenderer } from "./types";

/** A section holds a title and a description and takes no value. */
export const section: FieldRenderer = {
  decode: () => ({ value: undefined, issue: null }),
  encode: () => ({}),
  Component(props) {
    const settings = fieldTypes.section.settingsSchema.parse(props.field.settings);
    const description = settings.description
      ? resolveText(settings.description, props.locale, props.languages)
      : "";
    return (
      <section className={styles.section} data-field={props.field.key}>
        <h2 className={styles.sectionTitle}>
          {resolveText(settings.title, props.locale, props.languages)}
        </h2>
        {description ? <RichText source={description} className={styles.sectionBody} /> : null}
      </section>
    );
  },
};
