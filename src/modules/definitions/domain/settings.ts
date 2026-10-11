import { z } from "zod";

import { LIMITS } from "@/shared/domain/form-model";

export const CADENCES = ["per_submission", "daily"] as const;
export const DEFAULT_TIMEZONE = "America/Panama";

const MAX_RECIPIENTS = 20;
const PREFIX_PATTERN = /^[A-Z0-9]{2,6}$/;
const MAX_PREFIX_LENGTH = 6;
const MIN_PREFIX_LENGTH = 2;

/**
 * Operational settings of a form. They never create a version.
 * See specs/use-cases/manage-form-settings.md.
 */
export const settingsSchema = z.object({
  notificationRecipients: z.array(z.string().trim().toLowerCase()).max(MAX_RECIPIENTS).default([]),
  notificationCadence: z.enum(CADENCES).default("per_submission"),
  digestHour: z.number().int().min(0).max(23).default(9),
  timezone: z.string().default(DEFAULT_TIMEZONE),
  referencePrefix: z.string(),
  retentionMonths: z.number().int().default(LIMITS.retentionMonthsDefault),
  opensAt: z.iso.datetime().optional(),
  closesAt: z.iso.datetime().optional(),
  botChallenge: z.boolean().default(false),
  allowAnotherResponse: z.boolean().default(false),
});
export type FormSettings = z.infer<typeof settingsSchema>;

/**
 * Derives the default reference prefix from a slug: the initials of its
 * hyphen-separated words (a digits-only word contributes its first digit),
 * padded from the first word when shorter than two characters, cut to six.
 * See specs/form-definition.md, "Submissions".
 */
export function referencePrefixFromSlug(slug: string): string {
  const words = slug.split("-").filter((word) => word.length > 0);
  let prefix = words.map((word) => word.charAt(0)).join("");
  if (prefix.length < MIN_PREFIX_LENGTH) {
    prefix = (words[0] ?? "x").slice(0, MIN_PREFIX_LENGTH);
  }
  if (prefix.length < MIN_PREFIX_LENGTH) {
    prefix = prefix.repeat(MIN_PREFIX_LENGTH);
  }
  return prefix.toUpperCase().slice(0, MAX_PREFIX_LENGTH);
}

/** All documented defaults, with the reference prefix derived from the slug. */
export function defaultSettings(slug: string): FormSettings {
  return settingsSchema.parse({ referencePrefix: referencePrefixFromSlug(slug) });
}

export type SettingsCode =
  | "recipient_domain"
  | "recipient_syntax"
  | "too_many_recipients"
  | "prefix_format"
  | "retention_range"
  | "date_order"
  | "timezone_unknown"
  | "hour_range";

export interface SettingsIssue {
  code: SettingsCode;
  path: string;
  params?: Record<string, string | number>;
}

let knownZones: ReadonlySet<string> | undefined;

/** True for an IANA time zone identifier the runtime supports. */
export function isTimeZone(id: string): boolean {
  knownZones ??= new Set([...Intl.supportedValuesOf("timeZone"), "UTC"]);
  return knownZones.has(id);
}

/**
 * Semantic checks on settings. A recipient's domain is allowed only when it is
 * in `allowedRecipientDomains` (compared case-insensitively); configuration
 * puts the Workspace hosted domain first in that list.
 * See specs/use-cases/manage-form-settings.md, "Main flow".
 */
export function checkSettings(
  s: FormSettings,
  ctx: { allowedRecipientDomains: readonly string[] },
): SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  const allowed = new Set(ctx.allowedRecipientDomains.map((d) => d.toLowerCase()));

  if (s.notificationRecipients.length > MAX_RECIPIENTS) {
    issues.push({
      code: "too_many_recipients",
      path: "notificationRecipients",
      params: { max: MAX_RECIPIENTS },
    });
  }
  s.notificationRecipients.forEach((address, index) => {
    const path = `notificationRecipients.${String(index)}`;
    const parts = address.split("@");
    const [local, domain] = parts;
    if (parts.length !== 2 || !local || !domain) {
      issues.push({ code: "recipient_syntax", path, params: { index } });
    } else if (!allowed.has(domain.toLowerCase())) {
      issues.push({ code: "recipient_domain", path, params: { index } });
    }
  });

  if (!PREFIX_PATTERN.test(s.referencePrefix)) {
    issues.push({ code: "prefix_format", path: "referencePrefix" });
  }
  if (
    !Number.isInteger(s.retentionMonths) ||
    s.retentionMonths < LIMITS.retentionMonthsMin ||
    s.retentionMonths > LIMITS.retentionMonthsMax
  ) {
    issues.push({
      code: "retention_range",
      path: "retentionMonths",
      params: { min: LIMITS.retentionMonthsMin, max: LIMITS.retentionMonthsMax },
    });
  }
  if (s.opensAt !== undefined && s.closesAt !== undefined) {
    if (Date.parse(s.closesAt) <= Date.parse(s.opensAt)) {
      issues.push({ code: "date_order", path: "closesAt" });
    }
  }
  if (!isTimeZone(s.timezone)) {
    issues.push({ code: "timezone_unknown", path: "timezone" });
  }
  if (!Number.isInteger(s.digestHour) || s.digestHour < 0 || s.digestHour > 23) {
    issues.push({ code: "hour_range", path: "digestHour" });
  }
  return issues;
}

/** Setting keys whose values differ, for the `form_settings_changed` audit entry. */
export function changedKeys(before: FormSettings, after: FormSettings): (keyof FormSettings)[] {
  const keys = Object.keys(settingsSchema.shape) as (keyof FormSettings)[];
  return keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
