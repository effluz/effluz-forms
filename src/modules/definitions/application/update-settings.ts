import { LIMITS } from "@/shared/domain/form-model";
import { canEditSlug, type Form } from "../domain/form";
import {
  changedKeys,
  checkSettings,
  settingsSchema,
  type FormSettings,
  type SettingsCode,
  type SettingsIssue,
} from "../domain/settings";
import { checkSlug } from "../domain/slug";
import type { Actor, DefinitionsDeps } from "./deps";

export interface UpdateSettingsInput {
  formId: string;
  /** The full settings as the Settings tab submits them; parsed here. */
  settings: unknown;
  /** The requested slug; omitted or equal to the current one means no change. */
  slug?: string;
  /** The editor confirmed the purge count shown after `retention_confirm`. */
  confirmRetentionPurge?: boolean;
}

export type UpdateSettingsResult =
  | { ok: true; changed: string[] }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "invalid"; issues: SettingsIssue[] }
  | {
      ok: false;
      code: "slug_locked" | "slug_format" | "slug_reserved" | "slug_taken" | "prefix_locked";
    }
  | { ok: false; code: "retention_confirm"; count: number };

/**
 * Saves a form's operational settings and, before the first publish, its slug.
 * Settings never create a version. The update and its audit entries are
 * written in one unit of work; nothing is written when nothing changed.
 * See specs/use-cases/manage-form-settings.md.
 */
export async function updateSettings(
  deps: DefinitionsDeps,
  actor: Actor,
  input: UpdateSettingsInput,
): Promise<UpdateSettingsResult> {
  const form = await deps.forms.findById(input.formId);
  if (!form) return { ok: false, code: "not_found" };

  const parsed = settingsSchema.safeParse(input.settings);
  if (!parsed.success) return { ok: false, code: "invalid", issues: schemaIssues(parsed.error) };
  const settings = parsed.data;
  const issues = checkSettings(settings, {
    allowedRecipientDomains: deps.allowedRecipientDomains,
  });
  if (issues.length > 0) return { ok: false, code: "invalid", issues };

  const slug = input.slug ?? form.slug;
  const slugChanged = slug !== form.slug;
  if (slugChanged) {
    if (!canEditSlug(form)) return { ok: false, code: "slug_locked" };
    const slugIssue = checkSlug(slug);
    if (slugIssue) return { ok: false, code: slugIssue };
  }

  const before = form.settings;
  if (settings.referencePrefix !== before.referencePrefix && (await deps.stats.hasAny(form.id))) {
    return { ok: false, code: "prefix_locked" };
  }

  const now = deps.clock.now();
  let purged = 0;
  if (settings.retentionMonths < before.retentionMonths) {
    purged = await deps.stats.countOlderThan(form.id, settings.retentionMonths, now);
    if (purged > 0 && input.confirmRetentionPurge !== true) {
      return { ok: false, code: "retention_confirm", count: purged };
    }
  }

  const changed: string[] = changedKeys(before, settings);
  if (slugChanged) changed.push("slug");
  if (changed.length === 0) return { ok: true, changed };

  const next: Form = { ...form, slug, settings };
  return deps.uow.run(async (uow): Promise<UpdateSettingsResult> => {
    if ((await deps.forms.update(uow, next)) === "slug_taken") {
      return { ok: false, code: "slug_taken" };
    }
    const base = { actorEmail: actor.email, targetId: form.id, ip: actor.ip };
    await deps.audit.record(
      uow,
      { ...base, action: "form_settings_changed", details: { keys: changed.join(",") } },
      now,
    );
    if (purged > 0) {
      await deps.audit.record(
        uow,
        {
          ...base,
          action: "retention_shortened",
          details: { from: before.retentionMonths, to: settings.retentionMonths, count: purged },
        },
        now,
      );
    }
    return { ok: true, changed };
  });
}

type SchemaError = NonNullable<ReturnType<typeof settingsSchema.safeParse>["error"]>;
type SchemaIssue = SchemaError["issues"][number];

/**
 * The code a schema failure on each setting maps to. Cadence and the two
 * toggles come from fixed controls and have no user-facing code: a failure
 * there is a malformed request, not an editor's mistake.
 */
const CODE_FOR_KEY: Partial<Record<keyof FormSettings, SettingsCode>> = {
  notificationRecipients: "recipient_syntax",
  digestHour: "hour_range",
  timezone: "timezone_unknown",
  referencePrefix: "prefix_format",
  retentionMonths: "retention_range",
  opensAt: "date_order",
  closesAt: "date_order",
};

function schemaIssues(error: SchemaError): SettingsIssue[] {
  return error.issues.map(toSettingsIssue);
}

function toSettingsIssue(issue: SchemaIssue): SettingsIssue {
  const [key, index] = issue.path;
  const code = typeof key === "string" ? CODE_FOR_KEY[key as keyof FormSettings] : undefined;
  const path = issue.path.map(String).join(".");
  if (code === undefined) throw new Error(`malformed settings payload at "${path}"`);

  if (key === "notificationRecipients") {
    if (typeof index === "number") return { code, path, params: { index } };
    return issue.code === "too_big"
      ? { code: "too_many_recipients", path, params: { max: Number(issue.maximum) } }
      : { code, path };
  }
  if (code === "retention_range") {
    return {
      code,
      path,
      params: { min: LIMITS.retentionMonthsMin, max: LIMITS.retentionMonthsMax },
    };
  }
  return { code, path };
}
