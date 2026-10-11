import type { Version } from "@/shared/domain/form-model";
import { isComplete, type Languages, type LocalizedText } from "@/shared/domain/localized-text";
import { duplicateDocument, emptyDocument, type Draft } from "../domain/draft";
import type { Form } from "../domain/form";
import { defaultSettings, referencePrefixFromSlug, type FormSettings } from "../domain/settings";
import { checkSlug, slugFromTitle } from "../domain/slug";
import type { Actor, DefinitionsDeps } from "./deps";

export interface CreateFormInput {
  title: LocalizedText;
  languages: Languages;
  /** Defaults to a slug derived from the title. */
  slug?: string;
  /** The id of the form whose draft and settings are copied. */
  duplicateOf?: string;
}

export type CreateFormResult =
  | { ok: true; formId: string; slug: string }
  | {
      ok: false;
      code: "title_missing" | "slug_format" | "slug_reserved" | "slug_taken" | "source_not_found";
    };

interface Source {
  id: string;
  document: Version;
  settings: FormSettings;
}

/** Everything but the slug-bound prefix, the dates and the recipients. */
function duplicateSettings(source: FormSettings, slug: string): FormSettings {
  const settings: FormSettings = {
    ...structuredClone(source),
    notificationRecipients: [],
    referencePrefix: referencePrefixFromSlug(slug),
  };
  delete settings.opensAt;
  delete settings.closesAt;
  return settings;
}

async function findSource(deps: DefinitionsDeps, id: string): Promise<Source | null> {
  const [form, draft] = await Promise.all([deps.forms.findById(id), deps.drafts.find(id)]);
  if (!form || !draft) return null;
  return { id, document: draft.document, settings: form.settings };
}

/**
 * Creates a form in status `draft` with its first draft, blank or copied from
 * another form, in one unit of work.
 * See specs/use-cases/create-and-edit-form.md, "Main flow: create", and
 * specs/ui-ux/builder.md, "New form".
 */
export async function createForm(
  deps: DefinitionsDeps,
  actor: Actor,
  input: CreateFormInput,
): Promise<CreateFormResult> {
  if (!isComplete(input.title, input.languages)) return { ok: false, code: "title_missing" };
  const slug = input.slug ?? slugFromTitle(input.title, input.languages);
  const slugIssue = checkSlug(slug);
  if (slugIssue) return { ok: false, code: slugIssue };

  let source: Source | null = null;
  if (input.duplicateOf !== undefined) {
    source = await findSource(deps, input.duplicateOf);
    if (!source) return { ok: false, code: "source_not_found" };
  }

  const now = deps.clock.now();
  const formId = deps.ids.newId();
  const document: Version = source
    ? { ...duplicateDocument(source.document, input.title, deps.ids), languages: input.languages }
    : emptyDocument(input.title, input.languages, deps.ids);
  const form: Form = {
    id: formId,
    slug,
    title: input.title,
    languages: input.languages,
    status: "draft",
    settings: source ? duplicateSettings(source.settings, slug) : defaultSettings(slug),
    currentVersionId: null,
    currentVersionNumber: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  // Not marked audited: the first save is a `draft_saved` of its own.
  const draft: Draft = {
    formId,
    revision: 1,
    document,
    updatedBy: actor.email,
    updatedAt: now,
    auditedBy: null,
    auditedAt: null,
  };

  return deps.uow.run(async (uow): Promise<CreateFormResult> => {
    if ((await deps.forms.insert(uow, form)) === "slug_taken") {
      return { ok: false, code: "slug_taken" };
    }
    await deps.drafts.insert(uow, draft);
    await deps.audit.record(
      uow,
      {
        action: "form_created",
        actorEmail: actor.email,
        targetId: formId,
        ip: actor.ip,
        details: {
          languages: input.languages,
          ...(source ? { duplicateOf: source.id } : {}),
        },
      },
      now,
    );
    return { ok: true, formId, slug };
  });
}
