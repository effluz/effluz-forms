import { consentTextVersion, fieldTypes } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import { t } from "../copy";
import { styles } from "../styles";
import { describedBy, GroupShell } from "./FieldShell";
import { type FieldRenderer, ids, one } from "./types";

/** Consent text is plain text (specs/form-definition.md, "Consent"): paragraphs, never markup. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

export const consent: FieldRenderer = {
  decode: (input, field) => {
    if (input.get(field.key) !== "accepted") return { value: undefined, issue: null };
    const settings = fieldTypes.consent.settingsSchema.parse(field.settings);
    return {
      value: { accepted: true, textVersion: consentTextVersion(settings.text) },
      issue: null,
    };
  },
  encode: (value, field) =>
    typeof value === "object" && value !== null && "accepted" in value && value.accepted === true
      ? { [field.key]: "accepted" }
      : {},
  Component(props) {
    const settings = fieldTypes.consent.settingsSchema.parse(props.field.settings);
    const id = ids(props.field.key);
    const text = resolveText(settings.text, props.locale, props.languages);
    // The agreement is demanded whatever the field says, so the star always shows.
    const shown = { ...props, required: true };
    return (
      <GroupShell
        props={shown}
        legend={paragraphs(text).map((paragraph, index) => (
          <span key={index} className={styles.consentParagraph}>
            {paragraph}
          </span>
        ))}
      >
        <label htmlFor={id.control} className={styles.option}>
          <input
            id={id.control}
            type="checkbox"
            name={props.field.key}
            value="accepted"
            defaultChecked={one(props.values, props.field.key) === "accepted"}
            required
            aria-required="true"
            aria-invalid={props.error ? true : undefined}
            aria-describedby={describedBy(props) || undefined}
            // Described by the error as its fieldset is; a blur check keeps both (form-dom.ts).
            data-own-error=""
          />
          <span>{t(props.locale, "consent_checkbox")}</span>
        </label>
      </GroupShell>
    );
  },
};
