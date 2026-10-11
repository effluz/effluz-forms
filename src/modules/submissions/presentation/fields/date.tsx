import { t } from "../copy";
import { styles } from "../styles";
import { GroupShell } from "./FieldShell";
import { type FieldRenderer, ids, one } from "./types";

const PARTS = {
  day: { key: "date_day", maxLength: 2 },
  month: { key: "date_month", maxLength: 2 },
  year: { key: "date_year", maxLength: 4 },
} as const;

/** The order people write dates in: month first in English, day first in Spanish. */
const ORDER = {
  en: ["month", "day", "year"],
  es: ["day", "month", "year"],
} as const;

export const date: FieldRenderer = {
  decode: (input, field) => {
    const [d, m, y] = ["day", "month", "year"].map((p) =>
      (input.get(`${field.key}.${p}`) ?? "").trim(),
    );
    if (d === "" && m === "" && y === "") return { value: undefined, issue: null };
    if (!/^\d{1,2}$/.test(d ?? "") || !/^\d{1,2}$/.test(m ?? "") || !/^\d{4}$/.test(y ?? "")) {
      return { value: undefined, issue: "date_invalid" };
    }
    return {
      value: `${y ?? ""}-${(m ?? "").padStart(2, "0")}-${(d ?? "").padStart(2, "0")}`,
      issue: null,
    };
  },
  encode: (value, field) => {
    const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    if (!match) return {};
    return {
      [`${field.key}.day`]: String(Number(match[3])),
      [`${field.key}.month`]: String(Number(match[2])),
      [`${field.key}.year`]: match[1] ?? "",
    };
  },
  Component(props) {
    const base = ids(props.field.key).control;
    return (
      <GroupShell props={props}>
        <div className={styles.dateParts}>
          {ORDER[props.locale].map((part) => (
            <div key={part} className={styles.datePart}>
              <label htmlFor={`${base}-${part}`} className={styles.dateLabel}>
                {t(props.locale, PARTS[part].key)}
              </label>
              <input
                id={`${base}-${part}`}
                name={`${props.field.key}.${part}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={PARTS[part].maxLength}
                className={styles.input}
                defaultValue={one(props.values, `${props.field.key}.${part}`)}
                required={props.required}
                aria-required={props.required || undefined}
                aria-invalid={props.error ? true : undefined}
              />
            </div>
          ))}
        </div>
      </GroupShell>
    );
  },
};
