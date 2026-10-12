import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import {
  createForm,
  publishForm,
  publishPreview,
  updateSettings,
  type Actor,
  type DefinitionsDeps,
  type FormSettings,
} from "@/modules/definitions/application";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { PgSubmissionStats } from "@/modules/submissions/infrastructure/pg-submission-stats";
import { buildDefaultRegistry, parseDraft } from "@/shared/domain/form-model";
import type { Languages, LocalizedText } from "@/shared/domain/localized-text";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { bilingualFormDraft } from "../fixtures/bilingual-form";
import { referenceFormDraft, referenceSubmission } from "../fixtures/reference-form";
import { E2E_BASE_URL } from "../support/app-server";

const editor: Actor = { email: "editor@example.com", ip: "203.0.113.7" };
const DAY_MS = 86_400_000;

/** Definitions over Postgres, wired as the composition root wires them. */
function definitionsDeps(pool: Pool, publicBaseUrl: string): DefinitionsDeps {
  return {
    forms: new PgFormRepository(pool),
    drafts: new PgDraftRepository(pool),
    versions: new PgVersionRepository(pool),
    stats: new PgSubmissionStats(pool),
    audit: new PgAuditLog(),
    auditReader: new PgAuditLogReader(pool),
    uow: new PgUnitOfWorkFactory(pool),
    clock: systemClock,
    ids: systemIdGenerator,
    registry: buildDefaultRegistry(),
    allowedRecipientDomains: ["effluz.com", "example.com"],
    publicBaseUrl,
  };
}

export interface Published {
  formId: string;
  slug: string;
  deps: DefinitionsDeps;
}

/**
 * Publishes the reference form (tests/fixtures/reference-form.ts) under a
 * random slug through the definitions use cases, with prefix `HP`, 12 months
 * of retention, one staff recipient and a closing date 30 days out; `over`
 * replaces any setting. `publicBaseUrl` is the app the run started.
 */
export async function publishReferenceForm(
  pool: Pool,
  over: Partial<FormSettings> = {},
  publicBaseUrl = E2E_BASE_URL,
): Promise<Published> {
  return publishDraft(
    pool,
    {
      draft: referenceFormDraft,
      title: { es: "Historias" },
      languages: "es",
      slugPrefix: "historia-prematuro",
    },
    over,
    publicBaseUrl,
  );
}

/**
 * Publishes the bilingual form (tests/fixtures/bilingual-form.ts) as
 * `publishReferenceForm` publishes the reference form.
 */
export async function publishBilingualForm(
  pool: Pool,
  over: Partial<FormSettings> = {},
  publicBaseUrl = E2E_BASE_URL,
): Promise<Published> {
  return publishDraft(
    pool,
    {
      draft: bilingualFormDraft,
      title: bilingualFormDraft.title,
      languages: "bilingual",
      slugPrefix: "prueba-bilingue",
    },
    over,
    publicBaseUrl,
  );
}

async function publishDraft(
  pool: Pool,
  input: { draft: unknown; title: LocalizedText; languages: Languages; slugPrefix: string },
  over: Partial<FormSettings>,
  publicBaseUrl: string,
): Promise<Published> {
  const deps = definitionsDeps(pool, publicBaseUrl);
  const slug = `${input.slugPrefix}-${randomBytes(3).toString("hex")}`;
  const created = await createForm(deps, editor, {
    title: input.title,
    languages: input.languages,
    slug,
  });
  if (!created.ok) throw new Error(created.code);
  const formId = created.formId;

  const parsed = parseDraft(input.draft, deps.registry);
  if (!parsed.ok) throw new Error(`the ${input.slugPrefix} form does not parse`);
  await deps.uow.run(async (uow) => {
    const draft = await deps.drafts.findForUpdate(uow, formId);
    if (!draft) throw new Error("no draft");
    const saved = await deps.drafts.save(
      uow,
      { ...draft, document: parsed.version },
      draft.revision,
    );
    if (saved !== "saved") throw new Error(saved);
  });

  const form = await deps.forms.findById(formId);
  if (!form) throw new Error("no form");
  const settings: FormSettings = {
    ...form.settings,
    referencePrefix: "HP",
    retentionMonths: 12,
    notificationRecipients: ["staff-group@example.com"],
    notificationCadence: "per_submission",
    closesAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    ...over,
  };
  const updated = await updateSettings(deps, editor, { formId, settings });
  if (!updated.ok) throw new Error(updated.code);

  const preview = await publishPreview(deps, formId);
  if (!preview) throw new Error("no preview");
  const published = await publishForm(deps, editor, {
    formId,
    expectedNumber: preview.nextNumber,
    expectedRevision: preview.draftRevision,
  });
  if (!published.ok) throw new Error(published.code);
  return { formId, slug, deps };
}

/** The reference submission's values for one page, as form fields; `accepted` for consent. */
export function pageAnswers(pageKey: string): Record<string, string> {
  const page = referenceFormDraft.pages.find((p) => p.key === pageKey);
  if (!page) throw new Error(`no page ${pageKey}`);
  const out: Record<string, string> = {};
  for (const field of page.fields) {
    if (field.type === "consent") {
      out[field.key] = "accepted";
      continue;
    }
    const value = referenceSubmission[field.key];
    if (typeof value === "string") out[field.key] = value;
  }
  return out;
}
