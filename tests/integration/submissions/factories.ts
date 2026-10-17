import type { Pool } from "pg";
import type { FormSettings } from "@/modules/definitions/application";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { storyVersion } from "@/modules/submissions/domain/testing/versions";
import type { Version } from "@/shared/domain/form-model";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { sampleForm, sampleVersion } from "../definitions/factories";

/**
 * A published form whose only, current version holds `document`, written
 * through the real repositories; `settings` overrides the default settings.
 */
export async function seedPublishedForm(
  pool: Pool,
  document: Version = storyVersion(),
  settings: Partial<FormSettings> = {},
): Promise<{ formId: string; versionId: string; slug: string }> {
  const forms = new PgFormRepository(pool);
  const versions = new PgVersionRepository(pool);
  const base = sampleForm({ status: "published", languages: document.languages });
  const form = { ...base, settings: { ...base.settings, ...settings } };
  const version = { ...sampleVersion(form.id, 1), document };
  await new PgUnitOfWorkFactory(pool).run(async (uow) => {
    await forms.insert(uow, {
      ...form,
      currentVersionId: version.id,
      currentVersionNumber: version.number,
    });
    await versions.insert(uow, version);
  });
  return { formId: form.id, versionId: version.id, slug: form.slug };
}
