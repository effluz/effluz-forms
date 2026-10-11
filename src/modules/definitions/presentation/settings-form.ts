/**
 * Framework-free pieces of the Settings tab: the field values it shows, the
 * settings it posts, local times in a form's zone, and the copy for each
 * refusal. See specs/ui-ux/manager.md, "Settings tab", and
 * specs/use-cases/manage-form-settings.md.
 */
import { z } from "zod";
import type { CopyKey } from "@/shared/presentation/copy";
import type { UpdateSettingsResult } from "../application/update-settings";
import type { Form } from "../domain/form";
import { isTimeZone, type SettingsCode, type SettingsIssue } from "../domain/settings";

/** Every zone the runtime knows, offered by the time zone select; computed once. */
export const TIMEZONES: readonly string[] = ["UTC", ...Intl.supportedValuesOf("timeZone")];

/** The Settings fields as the form shows and posts them: text, except the two toggles. */
export interface SettingsValues {
  /** One address per line. */
  recipients: string;
  cadence: string;
  digestHour: string;
  timezone: string;
  retentionMonths: string;
  referencePrefix: string;
  /** A `datetime-local` value in `timezone`, or "". */
  opensAt: string;
  closesAt: string;
  botChallenge: boolean;
  allowAnotherResponse: boolean;
  slug: string;
}

/** A refusal shown on one field (slug, prefix) or above the form (`stale`). */
export type SettingsError =
  | Extract<
      UpdateSettingsResult,
      { code: "slug_locked" | "slug_format" | "slug_reserved" | "slug_taken" | "prefix_locked" }
    >["code"]
  | "stale";

/**
 * What a save that did not go through hands back to the tab: the values as
 * submitted and why.
 */
export interface SettingsFormState {
  values?: SettingsValues;
  issues?: SettingsIssue[];
  error?: SettingsError;
  retentionConfirm?: { count: number; months: number };
}

/**
 * The cookie that carries a refused save's state to the tab it redirects to
 * (Post/Redirect/Get), scoped to that tab's path and short-lived.
 */
export const SETTINGS_STATE_COOKIE = "effluz_settings_state";
export const SETTINGS_STATE_MAX_AGE_SECONDS = 600;
/** Below the 4 KB a browser keeps per cookie, with room for its attributes. */
const MAX_ENCODED_LENGTH = 3400;
/** The most issues the cookie keeps; a form has far fewer fields than this. */
const MAX_ISSUES = 20;

/** The posted field names; the settings ones are the setting keys. */
export const FIELD = {
  csrf: "csrf",
  recipients: "notificationRecipients",
  cadence: "notificationCadence",
  digestHour: "digestHour",
  timezone: "timezone",
  retentionMonths: "retentionMonths",
  referencePrefix: "referencePrefix",
  opensAt: "opensAt",
  closesAt: "closesAt",
  botChallenge: "botChallenge",
  allowAnotherResponse: "allowAnotherResponse",
  slug: "slug",
  confirm: "confirmRetentionPurge",
} as const;

/** The stored settings as field values, the dates in the form's own zone. */
export function settingsValues(form: Form): SettingsValues {
  const s = form.settings;
  const local = (iso: string | undefined) =>
    iso === undefined ? "" : utcToZonedInput(iso, s.timezone);
  return {
    recipients: s.notificationRecipients.join("\n"),
    cadence: s.notificationCadence,
    digestHour: String(s.digestHour),
    timezone: s.timezone,
    retentionMonths: String(s.retentionMonths),
    referencePrefix: s.referencePrefix,
    opensAt: local(s.opensAt),
    closesAt: local(s.closesAt),
    botChallenge: s.botChallenge,
    allowAnotherResponse: s.allowAnotherResponse,
    slug: form.slug,
  };
}

/** The values exactly as posted, to show them again after a refusal. */
export function readSettingsValues(form: FormData): SettingsValues {
  return {
    recipients: text(form, FIELD.recipients),
    cadence: text(form, FIELD.cadence),
    digestHour: text(form, FIELD.digestHour),
    timezone: text(form, FIELD.timezone),
    retentionMonths: text(form, FIELD.retentionMonths),
    referencePrefix: text(form, FIELD.referencePrefix),
    opensAt: text(form, FIELD.opensAt),
    closesAt: text(form, FIELD.closesAt),
    botChallenge: form.has(FIELD.botChallenge),
    allowAnotherResponse: form.has(FIELD.allowAnotherResponse),
    slug: text(form, FIELD.slug),
  };
}

/**
 * The settings object `updateSettings` parses, built from the posted tab.
 * Recipients are the non-blank lines, trimmed; the prefix is upper-cased.
 * Numbers that do not read as whole numbers and dates that do not read as
 * local times are passed through as posted, so the use case reports them on
 * their own paths. Dates are read in the posted zone, or in `timezone` when
 * the runtime does not know the posted one (the save is refused for it
 * anyway). `slug` is undefined when the field was not posted (it is disabled
 * once published). `confirm` is the purge confirmation button.
 */
export function parseSettingsForm(
  form: FormData,
  timezone: string,
): { settings: unknown; slug: string | undefined; confirm: boolean } {
  const v = readSettingsValues(form);
  const zone = isTimeZone(v.timezone) ? v.timezone : timezone;
  const settings: Record<string, unknown> = {
    notificationRecipients: lines(v.recipients),
    notificationCadence: v.cadence,
    digestHour: wholeNumber(v.digestHour),
    timezone: v.timezone,
    referencePrefix: v.referencePrefix.trim().toUpperCase(),
    retentionMonths: wholeNumber(v.retentionMonths),
  };
  for (const key of [FIELD.opensAt, FIELD.closesAt] as const) {
    const local = v[key].trim();
    if (local !== "") settings[key] = zonedTimeToUtc(local, zone) ?? local;
  }
  settings.botChallenge = v.botChallenge;
  settings.allowAnotherResponse = v.allowAnotherResponse;
  return {
    settings,
    slug: form.has(FIELD.slug) ? v.slug.trim() : undefined,
    confirm: text(form, FIELD.confirm) === "1",
  };
}

/** The non-blank lines of a text area, trimmed. */
export function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function wholeNumber(value: string): number | string {
  return /^\s*-?\d+\s*$/.test(value) ? Number(value) : value;
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const formats = new Map<string, Intl.DateTimeFormat>();

function formatIn(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formats.set(timeZone, format);
  }
  return format;
}

/** The wall-clock fields of `at` in `timeZone`. */
function wallClock(at: number, timeZone: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of formatIn(timeZone).formatToParts(at)) parts[part.type] = part.value;
  return parts;
}

/** How far `timeZone`'s wall clock is ahead of UTC at the instant `at`, in ms. */
function offsetAt(at: number, timeZone: string): number {
  const p = wallClock(at, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The UTC instant, as an ISO string, of a `datetime-local` value read in
 * `timezone`, or null when the value is not a real local date and time or the
 * zone is unknown. A time the clock skips (spring forward) moves forward by
 * the jump; a time that happens twice (fall back) is the later one.
 */
export function zonedTimeToUtc(local: string, timezone: string): string | null {
  const match = LOCAL_TIME.exec(local);
  if (!match || !isTimeZone(timezone)) return null;
  // Seconds are optional; a missing group reads as 0.
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((group) =>
    Number(match[group] ?? 0),
  ) as [number, number, number, number, number, number];
  if (hour > 23 || minute > 59 || second > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  // Two passes: the offset at the first guess, then at the instant it gives.
  const guess = wall - offsetAt(wall, timezone);
  return new Date(wall - offsetAt(guess, timezone)).toISOString();
}

/** The `datetime-local` value (minutes) of an instant in `timezone`; UTC when it is unknown. */
export function utcToZonedInput(iso: string, timezone: string): string {
  const p = wallClock(Date.parse(iso), isTimeZone(timezone) ? timezone : "UTC");
  return `${p.year ?? ""}-${p.month ?? ""}-${p.day ?? ""}T${p.hour ?? ""}:${p.minute ?? ""}`;
}

/** An instant as `YYYY-MM-DD HH:mm UTC`, the same in both languages. */
export function utcText(iso: string): string {
  const utc = new Date(iso).toISOString();
  return `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC`;
}

const ISSUE_COPY: Record<SettingsCode, CopyKey> = {
  recipient_domain: "set.err_recipient_domain",
  recipient_syntax: "set.err_recipient_syntax",
  too_many_recipients: "set.err_too_many_recipients",
  prefix_format: "set.err_prefix_format",
  retention_range: "set.err_retention_range",
  date_order: "set.err_date_order",
  timezone_unknown: "set.err_timezone_unknown",
  hour_range: "set.err_hour_range",
  malformed: "set.err_malformed",
};

/** The manager copy row explaining a settings issue. */
export function issueCopy(code: SettingsCode): CopyKey {
  return ISSUE_COPY[code];
}

const ERROR_COPY: Record<SettingsError, CopyKey> = {
  slug_locked: "set.err_slug_locked",
  slug_format: "set.err_slug_format",
  slug_reserved: "set.err_slug_reserved",
  slug_taken: "set.err_slug_taken",
  prefix_locked: "set.err_prefix_locked",
  stale: "set.err_stale",
};

/** The manager copy row explaining a refused save. */
export function errorCopy(code: SettingsError): CopyKey {
  return ERROR_COPY[code];
}

const stateSchema = z.object({
  values: z
    .object({
      recipients: z.string(),
      cadence: z.string(),
      digestHour: z.string(),
      timezone: z.string(),
      retentionMonths: z.string(),
      referencePrefix: z.string(),
      opensAt: z.string(),
      closesAt: z.string(),
      botChallenge: z.boolean(),
      allowAnotherResponse: z.boolean(),
      slug: z.string(),
    })
    .optional(),
  issues: z
    .array(
      z.object({
        code: z.enum(Object.keys(ISSUE_COPY) as [SettingsCode, ...SettingsCode[]]),
        path: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      }),
    )
    .optional(),
  error: z.enum(Object.keys(ERROR_COPY) as [SettingsError, ...SettingsError[]]).optional(),
  retentionConfirm: z.object({ count: z.number().int(), months: z.number() }).optional(),
});
const envelopeSchema = z.object({ at: z.string(), state: stateSchema });

/**
 * A refused save's state for `SETTINGS_STATE_COOKIE`, tagged with `at`, the
 * value the redirect carries in `refused`. Only the first 20 issues are kept.
 * When it would not fit in a cookie, the submitted values are dropped and the
 * tab shows the stored ones.
 */
export function encodeSettingsState(at: string, given: SettingsFormState): string {
  const state: SettingsFormState =
    given.issues !== undefined && given.issues.length > MAX_ISSUES
      ? { ...given, issues: given.issues.slice(0, MAX_ISSUES) }
      : given;
  const encode = (value: SettingsFormState) =>
    Buffer.from(JSON.stringify({ at, state: value })).toString("base64url");
  const full = encode(state);
  if (full.length <= MAX_ENCODED_LENGTH) return full;
  const withoutValues: SettingsFormState = { ...state };
  delete withoutValues.values;
  return encode(withoutValues);
}

/**
 * The state in the cookie when it belongs to the save `at` names, or null:
 * for another save, no cookie, or anything that does not read as a state.
 */
export function decodeSettingsState(
  raw: string | undefined,
  at: string | undefined,
): SettingsFormState | null {
  if (raw === undefined || at === undefined || at === "") return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success || parsed.data.at !== at) return null;
  // JSON carries no undefined members, so the optional keys are absent, not undefined.
  return parsed.data.state as SettingsFormState;
}
