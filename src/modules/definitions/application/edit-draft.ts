import type { Key, Version } from "@/shared/domain/form-model";
import { applyCommands, type CommandRejection, type DraftCommand } from "../domain/commands";
import { shouldAuditSave, type Draft } from "../domain/draft";
import type { Actor, DefinitionsDeps } from "./deps";

export interface EditDraftInput {
  formId: string;
  /** The revision the builder last saw; the edit applies only to that revision. */
  baseRevision: number;
  commands: readonly DraftCommand[];
}

export type EditDraftResult =
  | { ok: true; revision: number; document: Version; createdKeys: Key[] }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "stale"; revision: number; document: Version }
  | { ok: false; code: "rejected"; index: number; rejection: CommandRejection };

function stale(draft: Draft): EditDraftResult {
  return { ok: false, code: "stale", revision: draft.revision, document: draft.document };
}

/**
 * Applies a batch of builder commands to the draft in one unit of work, which
 * re-reads the form and then the draft with row locks before writing. A stale
 * base revision or a rejected command changes nothing.
 * See specs/use-cases/create-and-edit-form.md, "Main flow: edit the draft" and
 * "Audit entries".
 */
export async function editDraft(
  deps: DefinitionsDeps,
  actor: Actor,
  input: EditDraftInput,
): Promise<EditDraftResult> {
  const { formId, baseRevision, commands } = input;
  const [form, draft] = await Promise.all([deps.forms.findById(formId), deps.drafts.find(formId)]);
  if (!form || !draft) return { ok: false, code: "not_found" };
  if (baseRevision !== draft.revision) return stale(draft);

  const applied = applyCommands(draft.document, commands, {
    registry: deps.registry,
    ids: deps.ids,
  });
  if (!applied.ok) {
    return { ok: false, code: "rejected", index: applied.index, rejection: applied.rejection };
  }

  const now = deps.clock.now();
  const audited = shouldAuditSave(draft, actor.email, now);
  const next: Draft = {
    ...draft,
    document: applied.document,
    updatedBy: actor.email,
    updatedAt: now,
    ...(audited ? { auditedBy: actor.email, auditedAt: now } : {}),
  };
  const renamed = commands.some((command) => command.kind === "rename_form");
  const languageChanges = commands.filter((command) => command.kind === "set_languages");
  const mirrored = renamed || languageChanges.length > 0;

  return deps.uow.run(async (uow): Promise<EditDraftResult> => {
    // Rows are locked form first, then draft, in every use case, so two units
    // of work never wait on each other in opposite order.
    const freshForm = await deps.forms.findForUpdate(uow, formId);
    if (!freshForm) return { ok: false, code: "not_found" };
    const fresh = await deps.drafts.findForUpdate(uow, formId);
    if (!fresh) return { ok: false, code: "not_found" };
    // Another save landed after our read: hand back what is stored now.
    if (fresh.revision !== baseRevision) return stale(fresh);
    // The row is locked, so a stale save is a bug; throwing undoes the unit of work.
    if ((await deps.drafts.save(uow, next, baseRevision)) === "stale") {
      throw new Error(`draft of form ${formId} changed while locked`);
    }

    // The document is the source of truth; the form row mirrors its title and
    // languages (a narrower mode also drops the other locale's title text).
    if (mirrored) {
      const result = await deps.forms.update(uow, {
        ...freshForm,
        title: applied.document.title,
        languages: applied.document.languages,
        updatedAt: now,
      });
      if (result === "slug_taken") throw new Error(`form ${formId} slug conflict on update`);
    }
    for (const command of languageChanges) {
      await deps.audit.record(
        uow,
        {
          action: "draft_language_mode_changed",
          actorEmail: actor.email,
          targetId: formId,
          ip: actor.ip,
          details: { languages: command.languages },
        },
        now,
      );
    }
    if (audited) {
      await deps.audit.record(
        uow,
        {
          action: "draft_saved",
          actorEmail: actor.email,
          targetId: formId,
          ip: actor.ip,
          details: { commands: commands.length },
        },
        now,
      );
    }
    return {
      ok: true,
      revision: baseRevision + 1,
      document: applied.document,
      createdKeys: applied.createdKeys,
    };
  });
}

/** The working copy of a form, or null. See specs/ui-ux/builder.md, "Loading". */
export async function getDraft(deps: DefinitionsDeps, formId: string): Promise<Draft | null> {
  return deps.drafts.find(formId);
}
