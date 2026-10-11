import { beforeEach, describe, expect, it } from "vitest";
import { createForm } from "@/modules/definitions/application/create-form";
import type { DefinitionsDeps } from "@/modules/definitions/application/deps";
import { NullSubmissionStats } from "@/modules/definitions/infrastructure/null-submission-stats";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { buildDefaultRegistry } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

describe("createForm against Postgres", () => {
  const pool = testPool();
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
    registry: buildDefaultRegistry(),
    allowedRecipientDomains: ["effluz.com"],
    publicBaseUrl: "http://localhost:3000",
  };
  const actor = { email: "editor@example.com", ip: "203.0.113.7" };
  beforeEach(() => truncateAll(pool));

  async function count(table: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`);
    return rows[0]?.n ?? 0;
  }

  it("lets exactly one of two concurrent creations with the same slug win", async () => {
    const input = (en: string) => ({
      title: { en, es: `${en} (es)` },
      languages: "bilingual" as const,
      slug: "open-day",
    });
    const results = await Promise.all([
      createForm(deps, actor, input("Open day")),
      createForm(deps, actor, input("Open day again")),
    ]);

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([{ ok: false, code: "slug_taken" }]);
    expect(await count("form")).toBe(1);
    expect(await count("form_draft")).toBe(1);

    const winner = winners[0];
    if (!winner?.ok) throw new Error("no winner");
    const audit = await deps.auditReader.listByTarget({ targetId: winner.formId, limit: 10 });
    expect(audit.map((r) => r.action)).toEqual(["form_created"]);
  });

  it("commits the form, its draft and the audit entry together", async () => {
    const result = await createForm(deps, actor, {
      title: { en: "Spring fair", es: "Feria de primavera" },
      languages: "bilingual",
    });
    if (!result.ok) throw new Error(result.code);
    expect(result.slug).toBe("spring-fair");
    expect((await deps.forms.findById(result.formId))?.status).toBe("draft");
    expect((await deps.drafts.find(result.formId))?.revision).toBe(1);
    const audit = await deps.auditReader.listByTarget({ targetId: result.formId, limit: 10 });
    expect(audit).toMatchObject([
      {
        action: "form_created",
        actorEmail: actor.email,
        ip: actor.ip,
        details: { languages: "bilingual" },
      },
    ]);
  });
});
