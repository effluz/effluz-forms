import type { ReactElement } from "react";
import { type Field, fieldTypes, graphemeLength } from "@/shared/domain/form-model";
import { type Languages, type Locale, resolveText } from "@/shared/domain/localized-text";
import { t } from "../copy";
import { formatNumber } from "../format";
import { styles } from "../styles";
import { describedBy, FieldShell } from "./FieldShell";
import {
  type Decoded,
  type FieldInput,
  type FieldProps,
  type FieldRenderer,
  type FormValues,
  ids,
  one,
} from "./types";

/** A posted string is the answer unless it is blank, which is no answer. */
function decodeText(input: FieldInput, field: Field): Decoded {
  const raw = input.get(field.key) ?? "";
  return { value: raw.trim() === "" ? undefined : raw, issue: null };
}

function encodeText(value: unknown, field: Field): FormValues {
  return typeof value === "string" ? { [field.key]: value } : {};
}

function placeholder(
  text: Parameters<typeof resolveText>[0] | undefined,
  locale: Locale,
  languages: Languages,
): string | undefined {
  if (text === undefined) return undefined;
  return resolveText(text, locale, languages) || undefined;
}

const FULL_NAME = /^(your\s+)?full\s+name$|^(tu\s+)?nombre\s+completo$/;
const ORGANIZATION =
  /^(your\s+)?(organi[sz]ation|company|employer)$|^(tu\s+)?(organizaci[oó]n|empresa|instituci[oó]n)$/;

/**
 * The `autocomplete` token for a short text, inferred from its label only where the label
 * is unambiguous: a bare "Name" may be somebody else's name, so it stays off.
 */
function inferAutocomplete(label: string): string {
  const normalized = label
    .normalize("NFC")
    .toLowerCase()
    .replace(/[*:?¿]/g, "")
    .trim();
  if (FULL_NAME.test(normalized)) return "name";
  if (ORGANIZATION.test(normalized)) return "organization";
  return "off";
}

/** The one input every single-line text type shares. */
function Input(
  props: FieldProps & {
    type: "text" | "email" | "tel";
    inputMode?: "email" | "tel" | "text";
    autoComplete: string;
    placeholderText?: string | undefined;
  },
): ReactElement {
  const id = ids(props.field.key);
  return (
    <FieldShell props={props}>
      <input
        id={id.control}
        name={props.field.key}
        type={props.type}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        className={styles.input}
        defaultValue={one(props.values, props.field.key)}
        placeholder={props.placeholderText}
        required={props.required}
        aria-required={props.required || undefined}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(props) || undefined}
      />
    </FieldShell>
  );
}

export const shortText: FieldRenderer = {
  decode: decodeText,
  encode: encodeText,
  Component(props) {
    const settings = fieldTypes.short_text.settingsSchema.parse(props.field.settings);
    return (
      <Input
        {...props}
        type="text"
        autoComplete={inferAutocomplete(props.label)}
        placeholderText={placeholder(settings.placeholder, props.locale, props.languages)}
      />
    );
  },
};

export const email: FieldRenderer = {
  decode: decodeText,
  encode: encodeText,
  Component: (props) => <Input {...props} type="email" inputMode="email" autoComplete="email" />,
};

export const phone: FieldRenderer = {
  decode: decodeText,
  encode: encodeText,
  Component: (props) => <Input {...props} type="tel" inputMode="tel" autoComplete="tel" />,
};

export const longText: FieldRenderer = {
  decode: decodeText,
  encode: encodeText,
  Component(props) {
    const settings = fieldTypes.long_text.settingsSchema.parse(props.field.settings);
    const id = ids(props.field.key);
    const value = one(props.values, props.field.key);
    const limit = props.field.validation.find((rule) => rule.rule === "max_length");
    const max = limit?.value;
    const countId = `${props.field.key}-count`;
    return (
      <FieldShell props={props}>
        <textarea
          id={id.control}
          name={props.field.key}
          rows={settings.rows}
          data-autogrow=""
          className={styles.textarea}
          defaultValue={value}
          placeholder={placeholder(settings.placeholder, props.locale, props.languages)}
          required={props.required}
          aria-required={props.required || undefined}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={describedBy(props, max === undefined ? [] : [countId]) || undefined}
        />
        {max === undefined ? null : (
          <>
            {/* The grapheme count here is for the first paint; the server's count is the one that validates. */}
            <p
              id={countId}
              className={styles.counter}
              data-counter-for={id.control}
              data-max={max}
              data-template={t(props.locale, "char_count", {
                max: formatNumber(max, props.locale),
              })}
            >
              {t(props.locale, "char_count", {
                n: formatNumber(graphemeLength(value), props.locale),
                max: formatNumber(max, props.locale),
              })}
            </p>
            {/* Always present with a fixed politeness; the script writes the count here from 90 %. */}
            <p
              className={styles.visuallyHidden}
              aria-live="polite"
              data-counter-live-for={id.control}
            />
          </>
        )}
      </FieldShell>
    );
  },
};
