import { effectiveDisplay, fieldTypes } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import { t } from "../copy";
import { styles } from "../styles";
import { describedBy, FieldShell, GroupShell } from "./FieldShell";
import { type FieldRenderer, ids, many, one } from "./types";

export const singleChoice: FieldRenderer = {
  decode: (input, field) => {
    const raw = input.get(field.key) ?? "";
    return { value: raw === "" ? undefined : raw, issue: null };
  },
  encode: (value, field) => (typeof value === "string" ? { [field.key]: value } : {}),
  Component(props) {
    const settings = fieldTypes.single_choice.settingsSchema.parse(props.field.settings);
    const id = ids(props.field.key);
    const selected = one(props.values, props.field.key);
    const label = (o: (typeof settings.options)[number]): string =>
      resolveText(o.label, props.locale, props.languages);

    if (effectiveDisplay(settings) === "dropdown") {
      return (
        <FieldShell props={props}>
          <select
            id={id.control}
            name={props.field.key}
            className={styles.select}
            defaultValue={selected}
            required={props.required}
            aria-required={props.required || undefined}
            aria-invalid={props.error ? true : undefined}
            aria-describedby={describedBy(props) || undefined}
          >
            <option value="" disabled>
              {t(props.locale, "choose_one")}
            </option>
            {settings.options.map((o) => (
              <option key={o.key} value={o.key}>
                {label(o)}
              </option>
            ))}
          </select>
        </FieldShell>
      );
    }

    return (
      <GroupShell props={props}>
        <div className={styles.options}>
          {settings.options.map((o, index) => (
            <label key={o.key} className={styles.option}>
              <input
                id={index === 0 ? id.control : undefined}
                type="radio"
                name={props.field.key}
                value={o.key}
                defaultChecked={selected === o.key}
                required={props.required}
                aria-invalid={props.error ? true : undefined}
              />
              <span>{label(o)}</span>
            </label>
          ))}
        </div>
      </GroupShell>
    );
  },
};

export const multipleChoice: FieldRenderer = {
  decode: (input, field) => {
    const checked = input.getAll(field.key).filter((key) => key !== "");
    return { value: checked.length === 0 ? undefined : checked, issue: null };
  },
  encode: (value, field) =>
    Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")
      ? { [field.key]: value }
      : {},
  Component(props) {
    const settings = fieldTypes.multiple_choice.settingsSchema.parse(props.field.settings);
    const id = ids(props.field.key);
    const checked = many(props.values, props.field.key);
    return (
      <GroupShell props={props} sayRequired>
        <div className={styles.options}>
          {settings.options.map((o, index) => (
            <label key={o.key} className={styles.option}>
              <input
                id={index === 0 ? id.control : undefined}
                type="checkbox"
                name={props.field.key}
                value={o.key}
                defaultChecked={checked.includes(o.key)}
                aria-invalid={props.error ? true : undefined}
              />
              <span>{resolveText(o.label, props.locale, props.languages)}</span>
            </label>
          ))}
        </div>
      </GroupShell>
    );
  },
};
