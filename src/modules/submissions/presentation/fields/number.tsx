import { fieldTypes } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import { styles } from "../styles";
import { describedBy, FieldShell } from "./FieldShell";
import { type FieldRenderer, ids, one } from "./types";

const NOT_A_NUMBER = { value: undefined, ok: false } as const;

/** Whole digits grouped in threes by `group`: "1.234.567" or "1,234". */
const grouped = (whole: string, group: "." | ","): boolean =>
  new RegExp(`^-?\\d{1,3}(\\${group}\\d{3})+$`).test(whole);

/**
 * Postel: "2,5" and "2.5" both read as 2.5. With both separators, the last one is the decimal
 * mark and the other groups thousands ("1.234,5" and "1,234.5" are 1234.5); any other mix is
 * not a number rather than a guess. Empty is no answer.
 */
function parseNumber(raw: string): { value: number | undefined; ok: boolean } {
  const s = raw.trim().replace(/\s/g, "");
  if (s === "") return { value: undefined, ok: true };
  let normalized = s;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    const [whole = "", fraction, ...rest] = s.split(decimal);
    if (fraction === undefined || rest.length > 0 || !grouped(whole, group)) return NOT_A_NUMBER;
    normalized = `${whole.split(group).join("")}.${fraction}`;
  } else if (lastComma !== -1) {
    normalized = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return NOT_A_NUMBER;
  return { value: Number(normalized), ok: true };
}

export const number: FieldRenderer = {
  decode: (input, field) => {
    const { value, ok } = parseNumber(input.get(field.key) ?? "");
    return ok ? { value, issue: null } : { value: undefined, issue: "not_a_number" };
  },
  encode: (value, field) => (typeof value === "number" ? { [field.key]: String(value) } : {}),
  Component(props) {
    const settings = fieldTypes.number.settingsSchema.parse(props.field.settings);
    const id = ids(props.field.key);
    const unit = settings.unit ? resolveText(settings.unit, props.locale, props.languages) : "";
    const unitId = `${props.field.key}-unit`;
    return (
      <FieldShell props={props}>
        <div className={styles.numberRow}>
          <input
            id={id.control}
            name={props.field.key}
            type="text"
            inputMode={settings.integerOnly ? "numeric" : "decimal"}
            autoComplete="off"
            className={styles.input}
            defaultValue={one(props.values, props.field.key)}
            required={props.required}
            aria-required={props.required || undefined}
            aria-invalid={props.error ? true : undefined}
            aria-describedby={describedBy(props, unit ? [unitId] : []) || undefined}
          />
          {unit ? (
            <span id={unitId} className={styles.unit}>
              {unit}
            </span>
          ) : null}
        </div>
      </FieldShell>
    );
  },
};
