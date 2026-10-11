import type { ReactElement } from "react";
import type { Field, ValidationCode } from "@/shared/domain/form-model";
import type { Languages, Locale } from "@/shared/domain/localized-text";

/** The values of one field's controls by control name; a list for repeated names. */
export type FormValues = Readonly<Record<string, string | string[]>>;

/** What a decoder reads: the posted entries, as strings. */
export interface FieldInput {
  get(name: string): string | null;
  getAll(name: string): string[];
}

/** A decoded answer, or the decode issue that keeps it from becoming one. Value undefined: no answer. */
export interface Decoded {
  value: unknown;
  issue: ValidationCode | null;
}

/** A staged file as the page lists it (the original name is never kept). */
export interface FileRowView {
  id: string;
  kind: "image" | "video";
  label: string;
  size: string;
}

export interface FieldProps {
  field: Field;
  locale: Locale;
  languages: Languages;
  slug: string;
  label: string;
  help: string | null;
  required: boolean;
  /** The page's posted values when refused, else the stored answer encoded. */
  values: FormValues;
  /** The localized message for this field, or null. */
  error: string | null;
  files: readonly FileRowView[];
}

/**
 * One implementation per field type (specs/ui-ux/renderer.md, "Field rendering"): how its
 * controls are drawn, how a post becomes an answer and how an answer becomes control values.
 */
export interface FieldRenderer {
  decode: (input: FieldInput, field: Field) => Decoded;
  encode: (value: unknown, field: Field) => FormValues;
  Component: (props: FieldProps) => ReactElement | null;
}

/** The ids a field's markup links together. */
export function ids(key: string): {
  control: string;
  help: string;
  error: string;
  legend: string;
} {
  return {
    control: `f-${key}`,
    help: `${key}-help`,
    error: `${key}-error`,
    legend: `${key}-legend`,
  };
}

/** The first value under a name, or "". */
export const one = (values: FormValues, name: string): string => {
  const value = values[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};

/** Every value under a name. */
export const many = (values: FormValues, name: string): string[] => {
  const value = values[name];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
};
