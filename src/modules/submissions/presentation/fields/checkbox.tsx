import { styles } from "../styles";
import { describedBy, ErrorSlot, Help, Star } from "./FieldShell";
import { type FieldRenderer, ids, one } from "./types";

export const checkbox: FieldRenderer = {
  // Only the page's own fields are decoded, so an absent box means unchecked.
  decode: (input, field) => ({ value: input.get(field.key) === "on", issue: null }),
  encode: (value, field) => (value === true ? { [field.key]: "on" } : {}),
  Component(props) {
    const id = ids(props.field.key);
    return (
      <div className={styles.field} data-field={props.field.key}>
        {props.help ? (
          <div id={id.help}>
            <Help props={props} />
          </div>
        ) : null}
        <label htmlFor={id.control} className={styles.option}>
          <input
            id={id.control}
            type="checkbox"
            name={props.field.key}
            value="on"
            defaultChecked={one(props.values, props.field.key) === "on"}
            required={props.required}
            aria-required={props.required || undefined}
            aria-invalid={props.error ? true : undefined}
            aria-describedby={describedBy(props) || undefined}
          />
          <span>
            {props.label}
            <Star required={props.required} />
          </span>
        </label>
        <ErrorSlot props={props} />
      </div>
    );
  },
};
