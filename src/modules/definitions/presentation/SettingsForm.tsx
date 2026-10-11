import type { ReactNode } from "react";
import { LIMITS } from "@/shared/domain/form-model";
import { Banner } from "@/shared/presentation/Banner";
import { Bilingual } from "@/shared/presentation/Bilingual";
import type { CopyKey } from "@/shared/presentation/copy";
import { cx, styles } from "@/shared/presentation/styles";
import { canEditSlug, type Form } from "../domain/form";
import type { SettingsIssue } from "../domain/settings";
import local from "./forms.module.css";
import own from "./settings.module.css";
import {
  errorCopy,
  FIELD,
  issueCopy,
  lines,
  settingsValues,
  utcText,
  zonedTimeToUtc,
  type SettingsError,
  type SettingsValues,
} from "./settings-form";

export interface SettingsFormProps {
  form: Form;
  csrfToken: string;
  hasSubmissions: boolean;
  timezones: readonly string[];
  /** A URL to post to, or the server action. */
  action: string | ((formData: FormData) => void | Promise<void>);
  /** The values as submitted, shown instead of the stored settings after a refusal. */
  values?: SettingsValues;
  issues?: SettingsIssue[];
  error?: SettingsError;
  retentionConfirm?: { count: number; months: number };
  saved?: boolean;
}

type Field =
  | "recipients"
  | "cadence"
  | "hour"
  | "timezone"
  | "retention"
  | "prefix"
  | "opens"
  | "closes"
  | "challenge"
  | "another"
  | "slug";

/** The field each setting key's issues are shown on. */
const FIELD_OF_KEY: Record<string, Field> = {
  notificationRecipients: "recipients",
  notificationCadence: "cadence",
  digestHour: "hour",
  timezone: "timezone",
  retentionMonths: "retention",
  referencePrefix: "prefix",
  opensAt: "opens",
  closesAt: "closes",
  botChallenge: "challenge",
  allowAnotherResponse: "another",
};

/** The field a refused save is shown on; `stale` has none. */
const FIELD_OF_ERROR: Record<SettingsError, Field | null> = {
  slug_locked: "slug",
  slug_format: "slug",
  slug_reserved: "slug",
  slug_taken: "slug",
  prefix_locked: "prefix",
  stale: null,
};

interface Message {
  id: string;
  key: CopyKey;
  vars: Record<string, string>;
}

/** The id, invalid marker and description of a field's control. */
interface ControlProps {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  className?: string;
}

const TITLE_ID = "settings-title";
const RETENTION_WARN_ID = "settings-retention-warn";
const id = (field: Field | "form", suffix?: string) =>
  suffix === undefined ? `settings-${field}` : `settings-${field}-${suffix}`;

/**
 * The Settings tab body: one form in six sections, saved with one button.
 * Each issue sits under its field, which is marked invalid and described by
 * it. A server component: it works without JavaScript.
 * See specs/ui-ux/manager.md, "Settings tab".
 */
export function SettingsForm(props: SettingsFormProps) {
  const values = props.values ?? settingsValues(props.form);
  const messages = collectMessages(props, values);
  const slugLocked = !canEditSlug(props.form);

  const errorsOn = (field: Field) => messages.get(field) ?? [];
  const errorRows = (field: Field) =>
    errorsOn(field).map((message) => (
      <p key={message.id} id={message.id} role="alert" className={local.error}>
        <Bilingual k={message.key} vars={message.vars} />
      </p>
    ));
  /** A control's id, invalid marker and description: its error messages first, then `describedBy`. */
  const aria = (field: Field, describedBy: string[]): ControlProps => {
    const errors = errorsOn(field);
    const ids = [...errors.map((message) => message.id), ...describedBy];
    const props: ControlProps = { id: id(field) };
    if (errors.length > 0) props["aria-invalid"] = true;
    if (ids.length > 0) props["aria-describedby"] = ids.join(" ");
    return props;
  };
  /** `aria`, plus the input class, marked when the field has an error. */
  const control = (field: Field, describedBy: string[], extra?: string): ControlProps => ({
    ...aria(field, describedBy),
    className: cx(styles.input, extra, errorsOn(field).length > 0 && local.invalid),
  });
  const hint = (field: Field, k: CopyKey, suffix = "hint") => (
    <p id={id(field, suffix)} className={local.hint}>
      <Bilingual k={k} />
    </p>
  );

  const cadenceInvalid = errorsOn("cadence").length > 0;
  const zones = props.timezones.includes(values.timezone)
    ? props.timezones
    : [values.timezone, ...props.timezones];
  const recipients = lines(values.recipients);
  const utcOf = (value: string) => {
    const iso = zonedTimeToUtc(value.trim(), values.timezone);
    return iso === null ? null : utcText(iso);
  };
  const opensUtc = utcOf(values.opensAt);
  const closesUtc = utcOf(values.closesAt);

  return (
    <section aria-labelledby={TITLE_ID} className={own.settings}>
      <h2 id={TITLE_ID} className={own.title}>
        <Bilingual k="form.tab_settings" />
      </h2>
      {props.saved ? (
        <Banner tone="success">
          <Bilingual k="set.saved" />
        </Banner>
      ) : null}
      {(messages.get(null) ?? []).map((message) => (
        <Banner key={message.id} tone="danger">
          <span id={message.id}>
            <Bilingual k={message.key} vars={message.vars} />
          </span>
        </Banner>
      ))}

      <form
        {...(typeof props.action === "string"
          ? { method: "post", action: props.action }
          : { action: props.action })}
      >
        <input type="hidden" name={FIELD.csrf} value={props.csrfToken} />

        <Section k="set.notifications">
          <div className={styles.field}>
            <label htmlFor={id("recipients")} className={styles.label}>
              <Bilingual k="set.recipients" />
            </label>
            <textarea
              name={FIELD.recipients}
              rows={4}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={values.recipients}
              {...control(
                "recipients",
                [
                  id("recipients", "lines"),
                  id("recipients", "hint"),
                  ...(recipients.length === 0 ? [id("recipients", "none")] : []),
                ],
                own.textarea,
              )}
            />
            {errorRows("recipients")}
            {hint("recipients", "set.recipients_lines", "lines")}
            {hint("recipients", "set.recipients_hint")}
            {recipients.length === 0 ? hint("recipients", "set.no_recipients", "none") : null}
          </div>

          <fieldset className={own.group} {...describedByErrors(errorsOn("cadence"))}>
            <legend className={own.groupLegend}>
              <Bilingual k="set.cadence" />
            </legend>
            <Choice
              name={FIELD.cadence}
              value="per_submission"
              checked={values.cadence !== "daily"}
              invalid={cadenceInvalid}
            >
              <Bilingual k="set.cadence_each" />
            </Choice>
            <div className={own.row}>
              <Choice
                name={FIELD.cadence}
                value="daily"
                checked={values.cadence === "daily"}
                invalid={cadenceInvalid}
              >
                <span id={id("hour", "label")}>
                  <Bilingual k="set.cadence_daily" />
                </span>
              </Choice>
              <select
                name={FIELD.digestHour}
                defaultValue={values.digestHour}
                aria-labelledby={id("hour", "label")}
                {...control("hour", [])}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={String(hour)}>
                    {`${String(hour).padStart(2, "0")}:00`}
                  </option>
                ))}
              </select>
            </div>
            {errorRows("cadence")}
            {errorRows("hour")}
          </fieldset>
        </Section>

        <Section k="set.data">
          <div className={styles.field}>
            <label htmlFor={id("retention")} className={styles.label}>
              <Bilingual k="set.retention" />
            </label>
            <div className={own.row}>
              <input
                type="number"
                name={FIELD.retentionMonths}
                min={LIMITS.retentionMonthsMin}
                max={LIMITS.retentionMonthsMax}
                step={1}
                inputMode="numeric"
                defaultValue={values.retentionMonths}
                {...control(
                  "retention",
                  [
                    id("retention", "unit"),
                    ...(props.retentionConfirm ? [RETENTION_WARN_ID] : []),
                    id("retention", "hint"),
                  ],
                  own.months,
                )}
              />
              <span id={id("retention", "unit")}>
                <Bilingual k="set.months" />
              </span>
            </div>
            {errorRows("retention")}
            {hint("retention", "set.retention_hint")}
          </div>
          {props.retentionConfirm ? (
            <Banner tone="warning">
              <p id={RETENTION_WARN_ID} className={own.warnText}>
                <Bilingual
                  k="set.retention_warn"
                  vars={{
                    n: String(props.retentionConfirm.months),
                    count: String(props.retentionConfirm.count),
                  }}
                />
              </p>
            </Banner>
          ) : null}
          <div className={styles.field}>
            <label htmlFor={id("prefix")} className={styles.label}>
              <Bilingual k="set.prefix" />
            </label>
            <input
              type="text"
              name={FIELD.referencePrefix}
              maxLength={6}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              defaultValue={values.referencePrefix}
              {...(props.hasSubmissions ? { disabled: true } : {})}
              {...control("prefix", [id("prefix", "hint")], own.prefix)}
            />
            {props.hasSubmissions ? (
              // A disabled control is not posted; the locked value still is.
              <input
                type="hidden"
                name={FIELD.referencePrefix}
                value={props.form.settings.referencePrefix}
              />
            ) : null}
            {errorRows("prefix")}
            {hint("prefix", "set.prefix_hint")}
          </div>
        </Section>

        <Section k="set.availability">
          <div className={styles.field}>
            <label htmlFor={id("timezone")} className={styles.label}>
              <Bilingual k="set.timezone" />
            </label>
            <select
              name={FIELD.timezone}
              defaultValue={values.timezone}
              {...control("timezone", [id("timezone", "hint")])}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            {errorRows("timezone")}
            {hint("timezone", "set.timezone_hint")}
          </div>
          <DateField
            field="opens"
            name={FIELD.opensAt}
            label="set.opens"
            value={values.opensAt}
            utc={opensUtc}
            control={control}
            errors={errorRows("opens")}
          />
          <DateField
            field="closes"
            name={FIELD.closesAt}
            label="set.closes"
            value={values.closesAt}
            utc={closesUtc}
            control={control}
            errors={errorRows("closes")}
          />
        </Section>

        <Section k="set.protection">
          <div className={styles.field}>
            <label className={own.check}>
              <input
                type="checkbox"
                name={FIELD.botChallenge}
                defaultChecked={values.botChallenge}
                {...aria("challenge", [id("challenge", "hint")])}
              />
              <span>
                <Bilingual k="set.challenge" />
              </span>
            </label>
            {errorRows("challenge")}
            {hint("challenge", "set.challenge_hint")}
          </div>
        </Section>

        <Section k="set.responses">
          <div className={styles.field}>
            <label className={own.check}>
              <input
                type="checkbox"
                name={FIELD.allowAnotherResponse}
                defaultChecked={values.allowAnotherResponse}
                {...aria("another", [])}
              />
              <span>
                <Bilingual k="set.allow_another" />
              </span>
            </label>
            {errorRows("another")}
          </div>
        </Section>

        <Section k="set.link">
          <div className={styles.field}>
            <label htmlFor={id("slug")} className={styles.label}>
              <Bilingual k="new.slug" />
            </label>
            <input
              type="text"
              name={FIELD.slug}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={slugLocked ? props.form.slug : values.slug}
              {...(slugLocked ? { disabled: true } : {})}
              {...control("slug", [id("slug", "hint")])}
            />
            {errorRows("slug")}
            {hint("slug", "new.slug_hint")}
          </div>
        </Section>

        <div className={own.footer}>
          {messages.size > 0 || props.retentionConfirm ? (
            <p role="status" className={local.hint}>
              <Bilingual k="set.discard_warn" />
            </p>
          ) : null}
          {/* Save comes first in source order: it is the form's default button, so
              Enter in a field saves without ever confirming a purge. */}
          <button className={styles.primary} type="submit">
            <Bilingual k="set.save" />
          </button>
          {props.retentionConfirm ? (
            <button
              className={styles.destructive}
              type="submit"
              name={FIELD.confirm}
              value="1"
              aria-describedby={RETENTION_WARN_ID}
            >
              <Bilingual k="set.retention_confirm" />
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

/** Messages per field, plus those with no field of their own under `null`. */
function collectMessages(
  props: SettingsFormProps,
  values: SettingsValues,
): Map<Field | null, Message[]> {
  const byField = new Map<Field | null, Message[]>();
  const add = (field: Field | null, key: CopyKey, vars: Record<string, string>) => {
    const list = byField.get(field) ?? [];
    list.push({ id: `${id(field ?? "form", "error")}-${String(list.length)}`, key, vars });
    byField.set(field, list);
  };
  const recipients = lines(values.recipients);
  for (const issue of props.issues ?? []) {
    const field = FIELD_OF_KEY[issue.path.split(".")[0] ?? ""] ?? null;
    const vars: Record<string, string> = {};
    for (const [name, value] of Object.entries(issue.params ?? {})) vars[name] = String(value);
    const index = issue.params?.index;
    if (typeof index === "number") vars.address = recipients[index] ?? "";
    // An issue on a setting shows on its field; one on the payload itself, above the form.
    add(field, issueCopy(issue.code), vars);
  }
  if (props.error !== undefined) add(FIELD_OF_ERROR[props.error], errorCopy(props.error), {});
  return byField;
}

function describedByErrors(errors: Message[]) {
  return errors.length > 0
    ? { "aria-describedby": errors.map((message) => message.id).join(" ") }
    : {};
}

function Section(props: { k: CopyKey; children: ReactNode }) {
  return (
    <fieldset className={own.section}>
      <legend className={own.legend}>
        <h3 className={own.heading}>
          <Bilingual k={props.k} />
        </h3>
      </legend>
      {props.children}
    </fieldset>
  );
}

function Choice(props: {
  name: string;
  value: string;
  checked: boolean;
  invalid: boolean;
  children: ReactNode;
}) {
  return (
    <label className={local.choice}>
      <input
        type="radio"
        name={props.name}
        value={props.value}
        {...(props.checked ? { defaultChecked: true } : {})}
        {...(props.invalid ? { "aria-invalid": true } : {})}
      />
      <span>{props.children}</span>
    </label>
  );
}

function DateField(props: {
  field: Field;
  name: string;
  label: CopyKey;
  value: string;
  utc: string | null;
  control: (field: Field, describedBy: string[]) => ControlProps;
  errors: ReactNode;
}) {
  const utcId = id(props.field, "utc");
  return (
    <div className={styles.field}>
      <label htmlFor={id(props.field)} className={styles.label}>
        <Bilingual k={props.label} />
      </label>
      <input
        type="datetime-local"
        name={props.name}
        defaultValue={props.value}
        {...props.control(props.field, props.utc === null ? [] : [utcId])}
      />
      {props.errors}
      {props.utc === null ? null : (
        <p id={utcId} className={cx(local.hint, own.utc)}>
          {props.utc}
        </p>
      )}
    </div>
  );
}
