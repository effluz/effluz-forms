import type { BadgeTone } from "@/shared/presentation/Badge";
import { copy, fill, type Text } from "@/shared/presentation/copy";
import type { LocalizedText } from "@/shared/domain/localized-text";
import { LIFECYCLE_ACTIONS, type FormStatus, type LifecycleAction } from "../application";
import { nextStatus } from "../domain/form";

/** Badge tones per status; see design-system/components.md, "Badge". */
const TONES: Record<FormStatus, BadgeTone> = {
  draft: "neutral",
  published: "success",
  closed: "warning",
  archived: "neutral",
};

export function statusTone(status: FormStatus): BadgeTone {
  return TONES[status];
}

/** The status name, with the version for a published form ("Published v2"). */
export function statusText(status: FormStatus, versionNumber: number | null): Text {
  const text = copy[`status.${status}`];
  const vars = { n: versionNumber === null ? "" : String(versionNumber) };
  return { en: fill(text.en, vars), es: fill(text.es, vars) };
}

/** Moved to `shared/presentation` so review can use it; kept here for the pages that import it. */
export { formatDate } from "@/shared/presentation/format-date";

export type FormSection = "settings" | "share" | "activity" | "edit";

/** The form overview, or one of its sections. */
export function formHref(id: string, tab?: FormSection): string {
  const base = `/admin/forms/${encodeURIComponent(id)}`;
  return tab === undefined ? base : `${base}/${tab}`;
}

/** The overview with the confirmation for `action`, or for deleting, open. */
export function lifecycleHref(id: string, action: LifecycleAction | "delete"): string {
  return `${formHref(id)}?action=${action}`;
}

/** The lifecycle actions the domain allows from `status`, in their fixed order. */
export function allowedActions(
  status: FormStatus,
  versionNumber: number | null,
): LifecycleAction[] {
  const everPublished = versionNumber !== null;
  return LIFECYCLE_ACTIONS.filter(
    (action) => nextStatus(status, action, { everPublished }) !== null,
  );
}

function present(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** The form's titles as one plain string ("English / Spanish"), or the slug without any. */
export function titleText(title: LocalizedText, slug: string): string {
  const en = present(title.en);
  const es = present(title.es);
  if (en !== null && es !== null) return en === es ? en : `${en} / ${es}`;
  return en ?? es ?? slug;
}

/** Both titles when the form has both, for `BilingualText`; null otherwise. */
export function bilingualTitle(title: LocalizedText): Text | null {
  const en = present(title.en);
  const es = present(title.es);
  return en !== null && es !== null ? { en, es } : null;
}
