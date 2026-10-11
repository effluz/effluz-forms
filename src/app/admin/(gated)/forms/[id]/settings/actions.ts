"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { pageSession } from "@/app/admin/_lib/page";
import { DEFAULT_TIMEZONE, updateSettings } from "@/modules/definitions/application";
import {
  encodeSettingsState,
  FIELD,
  parseSettingsForm,
  readSettingsValues,
  SETTINGS_STATE_COOKIE,
  SETTINGS_STATE_MAX_AGE_SECONDS,
  type SettingsFormState,
} from "@/modules/definitions/presentation/settings-form";
import { formHref } from "@/modules/definitions/presentation/view-models";
import { constantTimeEqual } from "@/modules/identity/application";

/**
 * Saves the Settings tab: the page binds it to the form id and the form posts
 * to it, with or without JavaScript. It always ends in a redirect back to the
 * tab (Post/Redirect/Get). The session comes from the request cookie (sign-in
 * when there is none) and the CSRF token must match it. A save that goes
 * through returns with `saved`; any other result is kept in a short-lived
 * cookie on the tab's path and returns with `refused`, both set to the
 * save's time, so the tab shows that save's values and issues once.
 * See specs/ui-ux/manager.md, "Settings tab".
 */
export async function saveSettings(formId: string, formData: FormData): Promise<void> {
  const path = formHref(formId, "settings");
  const { session, container, actor } = await pageSession(path);
  const at = String(container.definitions.clock.now().getTime());
  const jar = await cookies();
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: container.config.session.secure,
    path,
  };
  const refuse = (state: SettingsFormState): never => {
    jar.set(SETTINGS_STATE_COOKIE, encodeSettingsState(at, state), {
      ...cookie,
      maxAge: SETTINGS_STATE_MAX_AGE_SECONDS,
    });
    redirect(`${path}?refused=${at}`);
  };

  const values = readSettingsValues(formData);
  const token = formData.get(FIELD.csrf);
  if (typeof token !== "string" || !constantTimeEqual(token, session.csrfToken)) {
    refuse({ values, error: "stale" });
  }

  const { settings, slug, confirm } = parseSettingsForm(formData, DEFAULT_TIMEZONE);
  const result = await updateSettings(container.definitions, actor, {
    formId,
    settings,
    ...(slug === undefined ? {} : { slug }),
    ...(confirm ? { confirmRetentionPurge: true } : {}),
  });
  if (result.ok) {
    jar.set(SETTINGS_STATE_COOKIE, "", { ...cookie, maxAge: 0 });
    redirect(`${path}?saved=${at}`);
  }
  switch (result.code) {
    case "not_found":
      notFound();
      break;
    case "invalid":
      refuse({ values, issues: result.issues });
      break;
    case "retention_confirm":
      refuse({
        values,
        retentionConfirm: { count: result.count, months: Number(values.retentionMonths) },
      });
      break;
    default:
      refuse({ values, error: result.code });
  }
}
