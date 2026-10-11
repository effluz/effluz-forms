import { beforeEach, describe, expect, it } from "vitest";
import { createForm } from "@/modules/definitions/application/create-form";
import type { DefinitionsDeps } from "@/modules/definitions/application/deps";
import { publishForm } from "@/modules/definitions/application/publish-form";
import { NullSubmissionStats } from "@/modules/definitions/infrastructure/null-submission-stats";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { buildDefaultRegistry, parseDraft } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

describe("publishForm against Postgres", () => {
  const pool = testPool();
  const registry = buildDefaultRegistry();
  // Same wiring as create-form.test.ts.
  const deps: DefinitionsDeps = {
    forms: new PgFormRepository(pool),
    drafts: new PgDraftRepository(pool),
    versions: new PgVersionRepository(pool),
    stats: new NullSubmissionStats(),
    audit: new PgAuditLog(),
    auditReader: new PgAuditLogReader(pool),
    uow: new PgUnitOfWorkFactory(pool),
    clock: systemClock,
    ids: systemIdGenerator,
    registry,
    allowedRecipientDomains: ["effluz.com"],
    publicBaseUrl: "http://localhost:3000",
  };
  const actor = { email: "editor@example.com", ip: "203.0.113.7" };
  beforeEach(() => truncateAll(pool));

  async function count(table: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`);
    return rows[0]?.n ?? 0;
  }

  /** Creates a form and saves a publishable synthetic document into its draft. */
  async function publishableForm(): Promise<{ formId: string; revision: number }> {
    const created = await createForm(deps, actor, {
      title: { en: "Open day", es: "Jornada abierta" },
      languages: "bilingual",
    });
    if (!created.ok) throw new Error(created.code);
    const draft = await deps.drafts.find(created.formId);
    if (!draft) throw new Error("no draft");
    const parsed = parseDraft(
      {
        languages: "bilingual",
        title: { en: "Open day", es: "Jornada abierta" },
        confirmation: { screen: { en: "Thank you", es: "Gracias" } },
        pages: [
          {
            key: "page_one",
            title: { en: "About", es: "Acerca de" },
            fields: [{ key: "f_name", type: "short_text", label: { en: "Name", es: "Nombre" } }],
          },
        ],
      },
      registry,
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const saved = await deps.uow.run((uow) =>
      deps.drafts.save(uow, { ...draft, document: parsed.version }, draft.revision),
    );
    if (saved !== "saved") throw new Error(saved);
    const form = await deps.forms.findById(created.formId);
    expect(form?.settings.retentionMonths).toBe(12);
    return { formId: created.formId, revision: draft.revision + 1 };
  }

  it("lets exactly one of two concurrent publishes of the same number win", async () => {
    const { formId, revision } = await publishableForm();

    const results = await Promise.all([
      publishForm(deps, actor, { formId, expectedNumber: 1 }),
      publishForm(deps, actor, { formId, expectedNumber: 1 }),
    ]);

    const winners = results.filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: "conflict" }]);
    expect(await count("form_version")).toBe(1);
    expect((await deps.drafts.find(formId))?.revision).toBe(revision + 1);

    const winner = winners[0];
    if (!winner?.ok) throw new Error("no winner");
    expect(winner.publicUrl).toBe("http://localhost:3000/f/open-day");
    expect(await deps.forms.findById(formId)).toMatchObject({
      status: "published",
      currentVersionId: winner.versionId,
      currentVersionNumber: 1,
    });
    const audit = await deps.auditReader.listByTarget({ targetId: formId, limit: 10 });
    expect(audit.filter((r) => r.action === "form_published")).toMatchObject([
      { actorEmail: actor.email, ip: actor.ip, details: { number: 1 } },
    ]);
  });

  it("leaves the published version immutable", async () => {
    const { formId } = await publishableForm();
    const result = await publishForm(deps, actor, { formId, expectedNumber: 1 });
    if (!result.ok) throw new Error(result.code);

    await expect(
      pool.query("update form_version set number = 5 where id = $1", [result.versionId]),
    ).rejects.toThrow(/immutable/);
  });
});
