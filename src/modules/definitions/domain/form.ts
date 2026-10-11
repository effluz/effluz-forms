import type { Languages, LocalizedText } from "@/shared/domain/localized-text";
import type { FormSettings } from "./settings";

export const FORM_STATUSES = ["draft", "published", "closed", "archived"] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const LIFECYCLE_ACTIONS = ["close", "reopen", "archive", "unarchive"] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

/** A form as managed by staff. See specs/form-definition.md, "Lifecycle". */
export interface Form {
  id: string;
  slug: string;
  title: LocalizedText;
  languages: Languages;
  status: FormStatus;
  settings: FormSettings;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TRANSITIONS: Record<LifecycleAction, Partial<Record<FormStatus, FormStatus>>> = {
  close: { published: "closed" },
  reopen: { closed: "published" },
  archive: { draft: "archived", published: "archived", closed: "archived" },
  unarchive: { archived: "closed" },
};

/**
 * The status a lifecycle action leads to, or null when the action is not
 * allowed from the current status.
 * See specs/form-definition.md, "Lifecycle".
 */
export function nextStatus(status: FormStatus, action: LifecycleAction): FormStatus | null {
  return TRANSITIONS[action][status] ?? null;
}

export const AUDIT_FOR_ACTION: Record<
  LifecycleAction,
  "form_closed" | "form_reopened" | "form_archived" | "form_unarchived"
> = {
  close: "form_closed",
  reopen: "form_reopened",
  archive: "form_archived",
  unarchive: "form_unarchived",
};

/** Only a form that was never published and has no submissions can be deleted. */
export function canDelete(form: Form, hasSubmissions: boolean): boolean {
  return form.currentVersionId === null && !hasSubmissions;
}

/** The slug is public once the form is published, so it is frozen from then on. */
export function canEditSlug(form: Form): boolean {
  return form.currentVersionId === null;
}

export type Unreachable = "draft" | "closed" | "archived" | "not_open_yet" | "past_close";
export type Reachability = { reachable: true } | { reachable: false; reason: Unreachable };

/**
 * Whether the public can open the form at `now`: status first, then the
 * opening and closing dates from the settings.
 * See specs/use-cases/manage-form-settings.md.
 */
export function reachability(form: Form, now: Date): Reachability {
  if (form.status === "archived") return { reachable: false, reason: "archived" };
  if (form.status === "closed") return { reachable: false, reason: "closed" };
  if (form.currentVersionId === null) return { reachable: false, reason: "draft" };
  const { opensAt, closesAt } = form.settings;
  if (opensAt !== undefined && now.getTime() < Date.parse(opensAt))
    return { reachable: false, reason: "not_open_yet" };
  if (closesAt !== undefined && now.getTime() >= Date.parse(closesAt))
    return { reachable: false, reason: "past_close" };
  return { reachable: true };
}
