import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { publicState, type Form } from "../domain/form";
import { formatReference } from "../domain/reference";
import type { DefinitionsDeps } from "./deps";
import type { FormVersion } from "./ports/version-repository";

export type PublicFormResult =
  | { state: "open"; form: Form; version: FormVersion }
  | { state: "closed"; form: Form }
  | { state: "not_open_yet"; form: Form; opensAt: string }
  | { state: "not_found" };

/**
 * What the public link `/f/<slug>` shows right now: the current version of an
 * open form, or the state that replaces the form.
 * See specs/use-cases/fill-and-submit-form.md.
 */
export async function resolvePublicForm(
  deps: DefinitionsDeps,
  slug: string,
): Promise<PublicFormResult> {
  const form = await deps.forms.findBySlug(slug);
  if (!form) return { state: "not_found" };
  const state = publicState(form, deps.clock.now());
  switch (state) {
    case "not_found":
      return { state };
    case "closed":
      return { state, form };
    case "not_open_yet": {
      const { opensAt } = form.settings;
      // reachability only reports not_open_yet when opensAt is set.
      if (opensAt === undefined) throw new Error(`form ${form.id} has no opening date`);
      return { state, form, opensAt };
    }
    case "open": {
      const version = await deps.versions.findCurrent(form.id);
      if (!version) return { state: "not_found" };
      return { state, form, version };
    }
  }
}

/**
 * A published version by id, null when unknown. Versions are immutable, so
 * callers may cache the result. See specs/form-definition.md, "Concepts".
 */
export async function loadVersion(
  deps: DefinitionsDeps,
  versionId: string,
): Promise<FormVersion | null> {
  return deps.versions.findById(versionId);
}

/** A form by id, null when unknown; a read for the renderer and submissions. */
export async function loadForm(deps: DefinitionsDeps, formId: string): Promise<Form | null> {
  return deps.forms.findById(formId);
}

export type AllocateReferenceResult =
  | { ok: true; reference: string; form: Form }
  | { ok: false; state: "closed" | "not_open_yet" | "not_found" };

/**
 * Takes the form's next submission reference inside the caller's unit of
 * work, under the form row lock, after deciding the public state again on the
 * locked row: a close that commits first wins, and a rolled-back intake gives
 * its number back. See specs/system/database.md, "The `UnitOfWork` port", and
 * specs/form-definition.md, "Submissions".
 */
export async function allocateReference(
  deps: DefinitionsDeps,
  uow: UnitOfWork,
  formId: string,
): Promise<AllocateReferenceResult> {
  const form = await deps.forms.findForUpdate(uow, formId);
  if (!form) return { ok: false, state: "not_found" };
  const state = publicState(form, deps.clock.now());
  if (state !== "open") return { ok: false, state };
  const n = await deps.forms.takeReferenceNumber(uow, formId);
  return { ok: true, reference: formatReference(form.settings.referencePrefix, n), form };
}
