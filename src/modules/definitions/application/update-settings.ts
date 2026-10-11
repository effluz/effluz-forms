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
 * written in one unit of work, decided again on the form row as re-read there
 * with a lock; nothing is written when nothing changed.
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

  let submissions: boolean | undefined;
  const hasSubmissions = async (): Promise<boolean> =>
    (submissions ??= await deps.stats.hasAny(form.id));
  const plan = (current: Form) => planChange(current, settings, input.slug, hasSubmissions);

  const early = await plan(form);
  if (!early.ok) return early;

  const now = deps.clock.now();
  // The purge count is advisory (submissions keep arriving), so it is taken
  // once, before the unit of work.
  let purged = 0;
  if (settings.retentionMonths < form.settings.retentionMonths) {
    purged = await deps.stats.countOlderThan(form.id, settings.retentionMonths, now);
    if (purged > 0 && input.confirmRetentionPurge !== true) {
      return { ok: false, code: "retention_confirm", count: purged };
    }
  }
  if (early.changed.length === 0) return { ok: true, changed: [] };

  return deps.uow.run(async (uow): Promise<UpdateSettingsResult> => {
    // Decided again on the locked row, so a concurrent status change or
    // publish is neither undone nor bypassed.
    const fresh = await deps.forms.findForUpdate(uow, form.id);
    if (!fresh) return { ok: false, code: "not_found" };
    const decided = await plan(fresh);
    if (!decided.ok) return decided;
    const { slug, changed } = decided;
    if (changed.length === 0) return { ok: true, changed };

    if ((await deps.forms.update(uow, { ...fresh, slug, settings })) === "slug_taken") {
      return { ok: false, code: "slug_taken" };
    }
    const base = { actorEmail: actor.email, targetId: form.id, ip: actor.ip };
    await deps.audit.record(
      uow,
      { ...base, action: "form_settings_changed", details: { keys: changed.join(",") } },
      now,
    );
    const from = fresh.settings.retentionMonths;
    if (purged > 0 && settings.retentionMonths < from) {
      await deps.audit.record(
        uow,
        {
          ...base,
          action: "retention_shortened",
          details: { from, to: settings.retentionMonths, count: purged },
        },
        now,
      );
    }
    return { ok: true, changed };
  });
}

type PlanRefusal = Extract<
  UpdateSettingsResult,
  { code: "slug_locked" | "slug_format" | "slug_reserved" | "slug_taken" | "prefix_locked" }
>;

/**
 * The slug to store and the keys that differ from `current`, or why the change
 * is refused. Runs on the plain read and again on the locked row.
 */
async function planChange(
  current: Form,
  settings: FormSettings,
  requestedSlug: string | undefined,
  hasSubmissions: () => Promise<boolean>,
): Promise<{ ok: true; slug: string; changed: string[] } | PlanRefusal> {
  const slug = requestedSlug ?? current.slug;
  const slugChanged = slug !== current.slug;
  if (slugChanged) {
    if (!canEditSlug(current)) return { ok: false, code: "slug_locked" };
    const slugIssue = checkSlug(slug);
    if (slugIssue) return { ok: false, code: slugIssue };
  }
  if (settings.referencePrefix !== current.settings.referencePrefix && (await hasSubmissions())) {
    return { ok: false, code: "prefix_locked" };
  }
  const changed: string[] = changedKeys(current.settings, settings);
  if (slugChanged) changed.push("slug");
  return { ok: true, slug, changed };
}

type SchemaError = NonNullable<ReturnType<typeof settingsSchema.safeParse>["error"]>;
type SchemaIssue = SchemaError["issues"][number];

/**
 * The code a schema failure on each setting maps to. Any other failure (the
 * payload itself, cadence, the two toggles, a non-numeric hour, a date that
 * is not an ISO datetime) is `malformed`: fixed controls cannot produce it, so
 * it is a tampered or broken request, not an editor's mistake.
 */
const CODE_FOR_KEY: Partial<Record<keyof FormSettings, SettingsCode>> = {
  notificationRecipients: "recipient_syntax",
  digestHour: "hour_range",
  timezone: "timezone_unknown",
  referencePrefix: "prefix_format",
  retentionMonths: "retention_range",
};

function schemaIssues(error: SchemaError): SettingsIssue[] {
  return error.issues.map(toSettingsIssue);
}

function toSettingsIssue(issue: SchemaIssue): SettingsIssue {
  const [key, index] = issue.path;
  const code = typeof key === "string" ? CODE_FOR_KEY[key as keyof FormSettings] : undefined;
  const path = issue.path.map(String).join(".");
  // The hour picker offers whole hours only; out of range is still `hour_range`.
  const malformedHour = code === "hour_range" && issue.code === "invalid_type";
  if (code === undefined || malformedHour) return { code: "malformed", path };

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
