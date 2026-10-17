import type { ReactElement, ReactNode } from "react";
import { RichText } from "@/shared/presentation/RichText";
import { t } from "../copy";
import { ErrorIcon } from "../ErrorIcon";
import { styles } from "../styles";
import { type FieldProps, ids } from "./types";

/** Whether the field has a help block: staff help, generated hints, or both. */
export const hasHelp = (props: FieldProps): boolean =>
  props.help !== null || props.hints.length > 0;

/** `aria-describedby` for a control: help, fixed hints, then the error when there is one. */
export function describedBy(props: FieldProps, extra: readonly string[] = []): string {
  const id = ids(props.field.key);
  return [hasHelp(props) ? id.help : null, ...extra, props.error ? id.error : null]
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

/**
 * The help block, linked from the control by `aria-describedby`: the staff help as rich text,
 * then the renderer's own hints as plain text, so a label inside a hint is never parsed.
 */
export function HelpBlock({ props }: { props: FieldProps }): ReactElement | null {
  if (!hasHelp(props)) return null;
  return (
    <div id={ids(props.field.key).help}>
      {props.help ? <RichText source={props.help} className={styles.help} /> : null}
      {props.hints.length > 0 ? (
        <div className={styles.help}>
          {props.hints.map((hint, index) => (
            <p key={index}>{hint}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
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
      <HelpBlock props={props} />
      {children}
      <ErrorSlot props={props} />
    </div>
  );
}

/**
 * The group variant: fieldset and legend for radios, checkboxes, dates and consent. A group
 * whose controls cannot carry `required` (`sayRequired`) says it in its legend, visually
 * hidden, since the star is hidden from assistive technology.
 */
export function GroupShell({
  props,
  legend,
  sayRequired = false,
  children,
}: {
  props: FieldProps;
  legend?: ReactNode;
  sayRequired?: boolean;
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
        {sayRequired && props.required ? (
          <span className={styles.visuallyHidden}>{` ${t(props.locale, "group_required")}`}</span>
        ) : null}
      </legend>
      <HelpBlock props={props} />
      {children}
      <ErrorSlot props={props} />
    </fieldset>
  );
}
