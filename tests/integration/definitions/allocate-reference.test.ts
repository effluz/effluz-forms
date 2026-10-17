import { beforeEach, describe, expect, it } from "vitest";
import type { DefinitionsDeps } from "@/modules/definitions/application/deps";
import { allocateReference } from "@/modules/definitions/application/public-form";
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
import { sampleForm, sampleVersion } from "./factories";

describe("allocateReference against Postgres", () => {
  const pool = testPool();
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
    registry: buildDefaultRegistry(),
    allowedRecipientDomains: ["effluz.com"],
    publicBaseUrl: "http://localhost:3000",
  };
  beforeEach(() => truncateAll(pool));

  /** Inserts a published form with version 1 current and returns its id. */
  async function publishedForm(): Promise<string> {
    const form = sampleForm({ status: "published" });
    const version = sampleVersion(form.id, 1);
    await deps.uow.run(async (uow) => {
      await deps.forms.insert(uow, form);
      await deps.versions.insert(uow, version);
      await deps.forms.update(uow, {
        ...form,
        currentVersionId: version.id,
        currentVersionNumber: 1,
      });
    });
    return form.id;
  }

  it("gives five concurrent intakes five distinct consecutive references", async () => {
    const formId = await publishedForm();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => deps.uow.run((uow) => allocateReference(deps, uow, formId))),
    );
    const refs = results.map((r) => (r.ok ? r.reference.split("-")[1] : "x")).sort();
    expect(refs).toEqual(["0001", "0002", "0003", "0004", "0005"]);
  });

  it("gives a rolled-back number back", async () => {
    const formId = await publishedForm();
    await expect(
      deps.uow.run(async (uow) => {
        await allocateReference(deps, uow, formId);
        throw new Error("intake failed");
      }),
    ).rejects.toThrow("intake failed");
    const next = await deps.uow.run((uow) => allocateReference(deps, uow, formId));
    expect(next.ok && next.reference.endsWith("-0001")).toBe(true);
  });

  it("advances next_reference without touching the form's updated_at", async () => {
    const formId = await publishedForm();
    const row = async () =>
      (
        await pool.query<{ next_reference: number; updated_at: Date }>(
          "select next_reference, updated_at from form where id = $1",
          [formId],
        )
      ).rows[0];
    const before = await row();
    await deps.uow.run((uow) => allocateReference(deps, uow, formId));
    const after = await row();
    expect(after?.next_reference).toBe((before?.next_reference ?? 0) + 1);
    expect(after?.updated_at).toEqual(before?.updated_at);
  });
});
