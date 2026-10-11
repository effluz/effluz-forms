import {
  canDelete,
  LIFECYCLE_ACTIONS,
  nextStatus,
  reachability,
  type Form,
  type LifecycleAction,
} from "../domain/form";
import { publicUrl, type Actor, type DefinitionsDeps } from "./deps";
import type { SubmissionSummary } from "./ports/submission-stats";

export interface FormOverview {
  form: Form;
  publicUrl: string;
  summary: SubmissionSummary;
  reachability: ReturnType<typeof reachability>;
  /** Whole days, rounded up, until the close date when it is at most seven days away. */
  closingInDays: number | null;
  canDelete: boolean;
  allowedActions: LifecycleAction[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSING_SOON_DAYS = 7;

/**
 * Only a form that can still be reachable is "closing"; a closed, archived or
 * never-published one is not.
 */
function closingInDays(form: Form, now: Date): number | null {
  const { closesAt } = form.settings;
  if (closesAt === undefined || form.currentVersionId === null) return null;
  if (form.status === "closed" || form.status === "archived") return null;
  const remaining = Date.parse(closesAt) - now.getTime();
  if (remaining <= 0) return null;
  const days = Math.ceil(remaining / DAY_MS);
  return days <= CLOSING_SOON_DAYS ? days : null;
}

/**
 * Opens a form's overview and records that the actor opened it, which resets
 * the "new" count on the home list.
 * See specs/ui-ux/manager.md, "Form overview".
 */
export async function openForm(
  deps: DefinitionsDeps,
  actor: Actor,
  formId: string,
): Promise<FormOverview | null> {
  const form = await deps.forms.findById(formId);
  if (!form) return null;
  const now = deps.clock.now();
  await deps.uow.run((uow) => deps.forms.markOpened(uow, form.id, actor.email, now));

  const [summaries, hasSubmissions] = await Promise.all([
    deps.stats.summary([form.id]),
    deps.stats.hasAny(form.id),
  ]);
  const everPublished = form.currentVersionId !== null;
  return {
    form,
    publicUrl: publicUrl(deps, form.slug),
    summary: summaries.get(form.id) ?? { total: 0, lastReceivedAt: null },
    reachability: reachability(form, now),
    closingInDays: closingInDays(form, now),
    canDelete: canDelete(form, hasSubmissions),
    allowedActions: LIFECYCLE_ACTIONS.filter(
      (action) => nextStatus(form.status, action, { everPublished }) !== null,
    ),
  };
}
