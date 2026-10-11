import { beforeEach, describe, expect, it } from "vitest";
import { createForm } from "@/modules/definitions/application/create-form";
import type { DefinitionsDeps } from "@/modules/definitions/application/deps";
import { editDraft } from "@/modules/definitions/application/edit-draft";
import { applyLifecycle } from "@/modules/definitions/application/lifecycle";
import { publishForm } from "@/modules/definitions/application/publish-form";
import { updateSettings } from "@/modules/definitions/application/update-settings";
import type { DraftCommand } from "@/modules/definitions/domain/commands";
import { NullSubmissionStats } from "@/modules/definitions/infrastructure/null-submission-stats";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { buildDefaultRegistry, parseDraft, type Key } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

/**
 * Two staff members acting on one form at once must never lose a write: the
 * mutating use cases lock the form and draft rows inside their unit of work.
 * See specs/system/database.md, "The `UnitOfWork` port". Each race runs a few
 * rounds so both orders get a chance to happen.
 */
describe("concurrent definitions use cases against Postgres", () => {
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
  const editor = { email: "editor@example.com", ip: "203.0.113.7" };
  const other = { email: "other@example.com", ip: "203.0.113.8" };
  const ROUNDS = 5;
  beforeEach(() => truncateAll(pool));

  async function versionCount(formId: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from form_version where form_id = $1",
      [formId],
    );
    return rows[0]?.n ?? 0;
  }

  /** A form whose draft holds a publishable synthetic document, and that draft's revision. */
  async function publishableForm(round: number): Promise<{ formId: string; revision: number }> {
    const title = { en: `Open day ${String(round)}`, es: `Jornada abierta ${String(round)}` };
    const created = await createForm(deps, editor, { title, languages: "bilingual" });
    if (!created.ok) throw new Error(created.code);
    const draft = await deps.drafts.find(created.formId);
    if (!draft) throw new Error("no draft");
    const parsed = parseDraft(
      {
        languages: "bilingual",
        title,
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
    return { formId: created.formId, revision: draft.revision + 1 };
  }

  it("never loses an archive that races a publish", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { formId, revision } = await publishableForm(round);

      const [published, archived] = await Promise.all([
        publishForm(deps, editor, { formId, expectedNumber: 1, expectedRevision: revision }),
        applyLifecycle(deps, other, { formId, action: "archive" }),
      ]);

      // Archiving is allowed from draft and from published, so it always wins.
      expect(archived).toEqual({ ok: true, status: "archived" });
      const form = await deps.forms.findById(formId);
      const draft = await deps.drafts.find(formId);
      expect(form?.status).toBe("archived");
      expect(form?.archivedAt).not.toBeNull();
      if (published.ok) {
        // Published first, then archived on top of the published row.
        expect(await versionCount(formId)).toBe(1);
        expect(form?.currentVersionId).toBe(published.versionId);
        expect(draft?.revision).toBe(revision + 1);
      } else {
        expect(published).toEqual({ ok: false, code: "archived" });
        expect(await versionCount(formId)).toBe(0);
        expect(form?.currentVersionId).toBeNull();
        expect(draft?.revision).toBe(revision);
      }
    }
  });

  it.each<[string, (round: number) => DraftCommand]>([
    [
      "a rename, which also writes the form row",
      (round) => ({
        kind: "rename_form",
        title: { en: `Renamed ${String(round)}`, es: `Renombrado ${String(round)}` },
      }),
    ],
    [
      "a field edit, which writes only the draft",
      () => ({
        kind: "update_field",
        fieldKey: "f_name" as Key,
        patch: { label: { en: "Full name", es: "Nombre completo" } },
      }),
    ],
  ])("never loses an edit that races a publish: %s", async (_name, command) => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { formId, revision } = await publishableForm(round);
      const before = await deps.drafts.find(formId);

      const [published, edited] = await Promise.all([
        publishForm(deps, editor, { formId, expectedNumber: 1, expectedRevision: revision }),
        editDraft(deps, other, { formId, baseRevision: revision, commands: [command(round)] }),
      ]);

      const form = await deps.forms.findById(formId);
      const draft = await deps.drafts.find(formId);
      if (!draft || !before) throw new Error("draft missing");
      if (edited.ok) {
        // The edit is in the stored draft whatever happened to the publish.
        expect(draft.document).toEqual(edited.document);
      } else {
        expect(edited.code).toBe("stale");
        expect(draft.document).toEqual(before.document);
      }
      if (published.ok) {
        expect(form).toMatchObject({ status: "published", currentVersionId: published.versionId });
        const version = await deps.versions.findById(published.versionId);
        expect(version?.document).toEqual(draft.document);
        // An edit that landed first moves the previewed revision, so the publish
        // wins only alone.
        expect(edited.ok).toBe(false);
        expect(draft.revision).toBe(revision + 1);
      } else {
        expect(published).toEqual({ ok: false, code: "conflict" });
        expect(edited.ok).toBe(true);
        expect(form).toMatchObject({ status: "draft", currentVersionId: null });
        expect(await versionCount(formId)).toBe(0);
        expect(draft.revision).toBe(revision + 1);
      }
    }
  });

  it("keeps both a settings change and a close that race each other", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { formId, revision } = await publishableForm(round);
      const first = await publishForm(deps, editor, {
        formId,
        expectedNumber: 1,
        expectedRevision: revision,
      });
      if (!first.ok) throw new Error(first.code);
      const settings = (await deps.forms.findById(formId))?.settings;
      if (!settings) throw new Error("form missing");

      const [saved, closed] = await Promise.all([
        updateSettings(deps, editor, { formId, settings: { ...settings, botChallenge: true } }),
        applyLifecycle(deps, other, { formId, action: "close" }),
      ]);

      expect(saved).toEqual({ ok: true, changed: ["botChallenge"] });
      expect(closed).toEqual({ ok: true, status: "closed" });
      expect(await deps.forms.findById(formId)).toMatchObject({
        status: "closed",
        settings: { botChallenge: true, retentionMonths: settings.retentionMonths },
      });
      const audit = await deps.auditReader.listByTarget({ targetId: formId, limit: 20 });
      expect(audit.map((r) => r.action)).toEqual(
        expect.arrayContaining(["form_settings_changed", "form_closed"]),
      );
    }
  });
});
