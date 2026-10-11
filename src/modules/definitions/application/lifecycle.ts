import {
  AUDIT_FOR_ACTION,
  canDelete,
  nextStatus,
  type Form,
  type FormStatus,
  type LifecycleAction,
} from "../domain/form";
import type { Actor, DefinitionsDeps } from "./deps";

export type LifecycleResult =
  { ok: true; status: FormStatus } | { ok: false; code: "not_found" | "invalid_transition" };

/**
 * Closes, reopens, archives or unarchives a form. The status change and its
 * audit entry are written in one unit of work, decided on the form row as
 * re-read there with a lock.
 * See specs/form-definition.md, "Lifecycle".
 */
export async function applyLifecycle(
  deps: DefinitionsDeps,
  actor: Actor,
  input: { formId: string; action: LifecycleAction },
): Promise<LifecycleResult> {
  const form = await deps.forms.findById(input.formId);
  if (!form) return { ok: false, code: "not_found" };
  if (nextStatusOf(form, input.action) === null) return { ok: false, code: "invalid_transition" };

  const now = deps.clock.now();
  return deps.uow.run(async (uow): Promise<LifecycleResult> => {
    // Decided again on the locked row: another actor may have acted meanwhile.
    const fresh = await deps.forms.findForUpdate(uow, form.id);
    if (!fresh) return { ok: false, code: "not_found" };
    const status = nextStatusOf(fresh, input.action);
    if (status === null) return { ok: false, code: "invalid_transition" };
    const archivedAt =
      input.action === "archive" ? now : input.action === "unarchive" ? null : fresh.archivedAt;
    // A status change never touches the slug, so `slug_taken` cannot happen.
    await deps.forms.update(uow, { ...fresh, status, archivedAt, updatedAt: now });
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
    return { ok: true, status };
  });
}

function nextStatusOf(form: Form, action: LifecycleAction): FormStatus | null {
  return nextStatus(form.status, action, { everPublished: form.currentVersionId !== null });
}

export type DeleteFormResult =
  { ok: true } | { ok: false; code: "not_found" | "not_allowed" | "slug_mismatch" };

/**
 * Deletes a form that was never published and has no submissions, together
 * with its draft. The editor confirms by typing the slug exactly. The rules
 * are checked again on the form row as re-read with a lock.
 * See specs/use-cases/publish-form.md.
 */
export async function deleteForm(
  deps: DefinitionsDeps,
  actor: Actor,
  input: { formId: string; slugConfirmation: string },
): Promise<DeleteFormResult> {
  const form = await deps.forms.findById(input.formId);
  if (!form) return { ok: false, code: "not_found" };
  // Read once, before the lock: a submission needs a version, so the version
  // check on the locked row below covers one that lands meanwhile.
  const hasSubmissions = await deps.stats.hasAny(form.id);
  const refusal = deleteRefusal(form, hasSubmissions, input.slugConfirmation);
  if (refusal) return { ok: false, code: refusal };

  const now = deps.clock.now();
  return deps.uow.run(async (uow): Promise<DeleteFormResult> => {
    // Decided again on the locked row: a publish or a slug change may have landed.
    const fresh = await deps.forms.findForUpdate(uow, form.id);
    if (!fresh) return { ok: false, code: "not_found" };
    const late = deleteRefusal(fresh, hasSubmissions, input.slugConfirmation);
    if (late) return { ok: false, code: late };
    await deps.forms.delete(uow, fresh.id);
    await deps.audit.record(
      uow,
      {
        action: "form_deleted",
        actorEmail: actor.email,
        targetId: fresh.id,
        ip: actor.ip,
        details: { slug: fresh.slug },
      },
      now,
    );
    return { ok: true };
  });
}

function deleteRefusal(
  form: Form,
  hasSubmissions: boolean,
  slugConfirmation: string,
): "not_allowed" | "slug_mismatch" | null {
  if (!canDelete(form, hasSubmissions)) return "not_allowed";
  return slugConfirmation === form.slug ? null : "slug_mismatch";
}
