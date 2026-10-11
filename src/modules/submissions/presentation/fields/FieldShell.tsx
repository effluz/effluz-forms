import type { ReactElement, ReactNode } from "react";
import { RichText } from "@/shared/presentation/RichText";
import { ErrorIcon } from "../ErrorIcon";
import { styles } from "../styles";
import { type FieldProps, ids } from "./types";

/** `aria-describedby` for a control: help, fixed hints, then the error when there is one. */
export function describedBy(props: FieldProps, extra: readonly string[] = []): string {
  const id = ids(props.field.key);
  return [props.help ? id.help : null, ...extra, props.error ? id.error : null]
    .filter(Boolean)
    .join(" ");
}

/** The star after a label of a required field; the legend and `required` say it to assistive technology. */
export function Star({ required }: { required: boolean }): ReactElement | null {
  return required ? (
    <span aria-hidden="true" className={styles.star}>
      {" *"}
    </span>
  ) : null;
}

export function Help({ props }: { props: FieldProps }): ReactElement | null {
  return props.help ? <RichText source={props.help} className={styles.help} /> : null;
}

/** The error slot is always present so a script can fill it; empty, it says nothing. */
export function ErrorSlot({ props }: { props: FieldProps }): ReactElement {
  return (
    <p id={ids(props.field.key).error} className={styles.error} aria-live="assertive">
      {props.error ? (
        <>
          <ErrorIcon />
          {props.error}
        </>
      ) : null}
    </p>
  );
}

/** Label, help, control, error: one visual group (Law of Proximity). */
export function FieldShell({
  props,
  children,
}: {
  props: FieldProps;
  children: ReactNode;
}): ReactElement {
  const id = ids(props.field.key);
  return (
    <div className={styles.field} data-field={props.field.key}>
      <label htmlFor={id.control} className={styles.label}>
        {props.label}
        <Star required={props.required} />
      </label>
      {props.help ? (
        <div id={id.help}>
          <Help props={props} />
        </div>
      ) : null}
      {children}
      <ErrorSlot props={props} />
    </div>
  );
}

/** The group variant: fieldset and legend for radios, checkboxes, dates and consent. */
export function GroupShell({
  props,
  legend,
  children,
}: {
  props: FieldProps;
  legend?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const id = ids(props.field.key);
  return (
    <fieldset
      className={styles.group}
      data-field={props.field.key}
      aria-describedby={describedBy(props) || undefined}
      aria-invalid={props.error ? true : undefined}
    >
      <legend id={id.legend} className={styles.label}>
        {legend ?? props.label}
        <Star required={props.required} />
      </legend>
      {props.help ? (
        <div id={id.help}>
          <Help props={props} />
        </div>
      ) : null}
      {children}
      <ErrorSlot props={props} />
    </fieldset>
  );
}
