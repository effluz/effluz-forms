import {
  AUDIT_FOR_ACTION,
  canDelete,
  nextStatus,
  type FormStatus,
  type LifecycleAction,
} from "../domain/form";
import type { Actor, DefinitionsDeps } from "./deps";

export type LifecycleResult =
  { ok: true; status: FormStatus } | { ok: false; code: "not_found" | "invalid_transition" };

/**
 * Closes, reopens, archives or unarchives a form. The status change and its
 * audit entry are written in one unit of work.
 * See specs/form-definition.md, "Lifecycle".
 */
export async function applyLifecycle(
  deps: DefinitionsDeps,
  actor: Actor,
  input: { formId: string; action: LifecycleAction },
): Promise<LifecycleResult> {
  const form = await deps.forms.findById(input.formId);
  if (!form) return { ok: false, code: "not_found" };
  const status = nextStatus(form.status, input.action, {
    everPublished: form.currentVersionId !== null,
  });
  if (status === null) return { ok: false, code: "invalid_transition" };

  const now = deps.clock.now();
  const archivedAt =
    input.action === "archive" ? now : input.action === "unarchive" ? null : form.archivedAt;
  await deps.uow.run(async (uow) => {
    // A status change never touches the slug, so `slug_taken` cannot happen.
    await deps.forms.update(uow, { ...form, status, archivedAt });
    await deps.audit.record(
      uow,
      {
        action: AUDIT_FOR_ACTION[input.action],
        actorEmail: actor.email,
        targetId: form.id,
        ip: actor.ip,
      },
      now,
    );
  });
  return { ok: true, status };
}

export type DeleteFormResult =
  { ok: true } | { ok: false; code: "not_found" | "not_allowed" | "slug_mismatch" };

/**
 * Deletes a form that was never published and has no submissions, together
 * with its draft. The editor confirms by typing the slug exactly.
 * See specs/use-cases/publish-form.md.
 */
export async function deleteForm(
  deps: DefinitionsDeps,
  actor: Actor,
  input: { formId: string; slugConfirmation: string },
): Promise<DeleteFormResult> {
  const form = await deps.forms.findById(input.formId);
  if (!form) return { ok: false, code: "not_found" };
  if (!canDelete(form, await deps.stats.hasAny(form.id))) return { ok: false, code: "not_allowed" };
  if (input.slugConfirmation !== form.slug) return { ok: false, code: "slug_mismatch" };

  const now = deps.clock.now();
  await deps.uow.run(async (uow) => {
    await deps.forms.delete(uow, form.id);
    await deps.audit.record(
      uow,
      {
        action: "form_deleted",
        actorEmail: actor.email,
        targetId: form.id,
        ip: actor.ip,
        details: { slug: form.slug },
      },
      now,
    );
  });
  return { ok: true };
}
