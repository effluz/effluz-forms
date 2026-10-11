import { describe, expect, it } from "vitest";
import type { Key } from "@/shared/domain/form-model";
import type { DraftCommand } from "../domain/commands";
import { editDraft, getDraft } from "./edit-draft";
import {
  EDITOR,
  fakeUuid,
  makeDefinitionsDeps,
  seedForm,
  withConcurrentChange,
} from "./testing/fakes";

const OTHER = { email: "other@example.com", ip: "203.0.113.8" };
const MINUTE_MS = 60_000;

async function setup() {
  const deps = makeDefinitionsDeps();
  const formId = await seedForm(deps);
  const draft = await deps.drafts.find(formId);
  const page = draft?.document.pages[0];
  if (!draft || !page) throw new Error("seed failed");
  // Seeding wrote `form_created`; the tests count only what editing writes.
  deps.audit.entries.length = 0;
  return { deps, formId, pageKey: page.key, revision: draft.revision };
}

function auditActions(deps: Awaited<ReturnType<typeof setup>>["deps"]): string[] {
  return deps.audit.entries.map(({ entry }) => entry.action);
}

describe("editDraft", () => {
  it("applies the commands, bumps the revision and returns the created keys", async () => {
    const { deps, formId, pageKey, revision } = await setup();
    deps.clock.advance(MINUTE_MS);
    const commands: DraftCommand[] = [
      { kind: "add_field", pageKey, type: "short_text" },
      { kind: "add_field", pageKey, type: "email" },
    ];
    const result = await editDraft(deps, EDITOR, { formId, baseRevision: revision, commands });

    if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
    expect(result.revision).toBe(revision + 1);
    expect(result.createdKeys).toHaveLength(2);
    expect(result.document.pages[0]?.fields.map((f) => f.key)).toEqual(result.createdKeys);

    const stored = await deps.drafts.find(formId);
    expect(stored?.revision).toBe(revision + 1);
    expect(stored?.document).toEqual(result.document);
    expect(stored?.updatedBy).toBe(EDITOR.email);
    expect(stored?.updatedAt).toEqual(deps.clock.now());
  });

  it("returns not_found for an unknown form and for a form without a draft", async () => {
    const { deps, formId } = await setup();
    const commands: DraftCommand[] = [{ kind: "add_page" }];
    expect(
      await editDraft(deps, EDITOR, { formId: fakeUuid(99), baseRevision: 1, commands }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(await editDraft(deps, EDITOR, { formId: "nope", baseRevision: 1, commands })).toEqual({
      ok: false,
      code: "not_found",
    });

    deps.store.drafts.delete(formId);
    expect(await editDraft(deps, EDITOR, { formId, baseRevision: 1, commands })).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("returns stale with the current document and writes nothing when the base revision is old", async () => {
    const { deps, formId, revision } = await setup();
    const before = await deps.drafts.find(formId);
    const result = await editDraft(deps, EDITOR, {
      formId,
      baseRevision: revision - 1,
      commands: [{ kind: "add_page" }],
    });

    expect(result).toEqual({
      ok: false,
      code: "stale",
      revision,
      document: before?.document,
    });
    expect(await deps.drafts.find(formId)).toEqual(before);
    expect(deps.audit.entries).toHaveLength(0);
  });

  it("throws when the locked draft still reports stale on save, a bug", async () => {
    const { deps, formId, revision } = await setup();
    const broken: typeof deps.drafts = Object.assign(
      Object.create(deps.drafts) as typeof deps.drafts,
      { save: () => Promise.resolve("stale" as const) },
    );

    await expect(
      editDraft({ ...deps, drafts: broken }, EDITOR, {
        formId,
        baseRevision: revision,
        commands: [{ kind: "rename_form", title: { en: "Renamed", es: "Renombrado" } }],
      }),
    ).rejects.toThrow(/changed while locked/);
  });

  it("locks the form row before the draft, also for an edit that does not mirror", async () => {
    const { deps, formId, pageKey, revision } = await setup();
    const locks: string[] = [];
    const record = <R extends { findForUpdate: (...args: never[]) => unknown }>(
      repo: R,
      name: string,
    ): R =>
      Object.assign(Object.create(repo) as R, {
        findForUpdate: (...args: Parameters<R["findForUpdate"]>) => {
          locks.push(name);
          return repo.findForUpdate(...args);
        },
      });

    const result = await editDraft(
      { ...deps, forms: record(deps.forms, "form"), drafts: record(deps.drafts, "draft") },
      EDITOR,
      {
        formId,
        baseRevision: revision,
        commands: [{ kind: "add_field", pageKey, type: "short_text" }],
      },
    );

    expect(result.ok).toBe(true);
    expect(locks).toEqual(["form", "draft"]);
  });

  it("returns the rejection with its index and writes nothing", async () => {
    const { deps, formId, pageKey, revision } = await setup();
    const before = await deps.drafts.find(formId);
    const result = await editDraft(deps, EDITOR, {
      formId,
      baseRevision: revision,
      commands: [
        { kind: "add_field", pageKey, type: "short_text" },
        { kind: "delete_field", fieldKey: "f_missing000" as Key },
        { kind: "add_page" },
      ],
    });

    expect(result).toEqual({
      ok: false,
      code: "rejected",
      index: 1,
      rejection: { code: "unknown_field", params: { key: "f_missing000" } },
    });
    expect(await deps.drafts.find(formId)).toEqual(before);
    expect(deps.audit.entries).toHaveLength(0);
  });

  it("mirrors a rename onto the form title", async () => {
    const { deps, formId, revision } = await setup();
    const title = { en: "Open day", es: "Día abierto" };
    const result = await editDraft(deps, EDITOR, {
      formId,
      baseRevision: revision,
      commands: [{ kind: "rename_form", title }],
    });

    expect(result.ok).toBe(true);
    const form = await deps.forms.findById(formId);
    expect(form?.title).toEqual(title);
    expect(form?.slug).toBe("sample-form");
    expect(form?.languages).toBe("bilingual");
    expect((await deps.drafts.find(formId))?.document.title).toEqual(title);
  });

  describe("when another actor commits between the read and the lock", () => {
    it("returns stale with the fresh draft and writes nothing", async () => {
      const { deps, formId, revision } = await setup();
      const theirs = { en: "Their title", es: "Su título" };
      const drafts = withConcurrentChange(deps.drafts, () => {
        const stored = deps.store.drafts.get(formId);
        if (!stored) throw new Error("no draft");
        deps.store.drafts.set(formId, {
          ...stored,
          revision: revision + 1,
          document: { ...stored.document, title: theirs },
          updatedBy: OTHER.email,
        });
      });

      const result = await editDraft({ ...deps, drafts }, EDITOR, {
        formId,
        baseRevision: revision,
        commands: [{ kind: "rename_form", title: { en: "Mine", es: "Mío" } }],
      });

      const current = await deps.drafts.find(formId);
      expect(result).toEqual({
        ok: false,
        code: "stale",
        revision: revision + 1,
        document: current?.document,
      });
      expect(current?.document.title).toEqual(theirs);
      expect((await deps.forms.findById(formId))?.title.en).toBe("Sample form");
      expect(deps.audit.entries).toEqual([]);
    });

    it("mirrors a rename onto the fresh form row, keeping a status changed meanwhile", async () => {
      const { deps, formId, revision } = await setup();
      const archivedAt = new Date("2026-10-10T11:00:00Z");
      const forms = withConcurrentChange(deps.forms, () => {
        const stored = deps.store.forms.get(formId);
        if (!stored) throw new Error("no form");
        deps.store.forms.set(formId, { ...stored, status: "archived", archivedAt });
      });
      const title = { en: "Open day", es: "Día abierto" };

      const result = await editDraft({ ...deps, forms }, EDITOR, {
        formId,
        baseRevision: revision,
        commands: [{ kind: "rename_form", title }],
      });

      expect(result.ok).toBe(true);
      expect(await deps.forms.findById(formId)).toMatchObject({
        title,
        status: "archived",
        archivedAt,
      });
    });
  });

  it("does not touch the form row when neither title nor languages change", async () => {
    const { deps, formId, pageKey, revision } = await setup();
    const before = await deps.forms.findById(formId);
    deps.clock.advance(MINUTE_MS);
    await editDraft(deps, EDITOR, {
      formId,
      baseRevision: revision,
      commands: [{ kind: "add_field", pageKey, type: "short_text" }],
    });
    expect(await deps.forms.findById(formId)).toEqual(before);
  });

  it("updates the form languages and audits every language mode change", async () => {
    const { deps, formId, revision } = await setup();
    const first = await editDraft(deps, EDITOR, {
      formId,
      baseRevision: revision,
      commands: [{ kind: "set_languages", languages: "en", keep: "en" }],
    });
    expect(first.ok).toBe(true);
    expect((await deps.forms.findById(formId))?.languages).toBe("en");
    expect((await deps.forms.findById(formId))?.title).toEqual({ en: "Sample form" });

    // Within the five-minute window: the mode change is audited, the save is not.
    deps.clock.advance(MINUTE_MS);
    const second = await editDraft(deps, EDITOR, {
      formId,
      baseRevision: revision + 1,
      commands: [{ kind: "set_languages", languages: "bilingual" }],
    });
    expect(second.ok).toBe(true);
    expect((await deps.forms.findById(formId))?.languages).toBe("bilingual");

    const changes = deps.audit.entries.filter(
      ({ entry }) => entry.action === "draft_language_mode_changed",
    );
    expect(changes.map(({ entry }) => entry.details)).toEqual([
      { languages: "en" },
      { languages: "bilingual" },
    ]);
    expect(changes[0]?.entry).toMatchObject({
      actorEmail: EDITOR.email,
      targetId: formId,
      ip: EDITOR.ip,
    });
  });

  it("audits one entry per set_languages command in a batch", async () => {
    const { deps, formId, revision } = await setup();
    await editDraft(deps, EDITOR, {
      formId,
      baseRevision: revision,
      commands: [
        { kind: "set_languages", languages: "es", keep: "es" },
        { kind: "set_languages", languages: "bilingual" },
      ],
    });
    expect(
      deps.audit.entries
        .filter(({ entry }) => entry.action === "draft_language_mode_changed")
        .map(({ entry }) => entry.details),
    ).toEqual([{ languages: "es" }, { languages: "bilingual" }]);
  });

  describe("draft_saved coalescing", () => {
    it("audits the first save with the command count, actor, target and ip", async () => {
      const { deps, formId, pageKey, revision } = await setup();
      deps.clock.advance(MINUTE_MS);
      await editDraft(deps, EDITOR, {
        formId,
        baseRevision: revision,
        commands: [
          { kind: "add_field", pageKey, type: "short_text" },
          { kind: "add_field", pageKey, type: "short_text" },
        ],
      });

      expect(deps.audit.entries).toHaveLength(1);
      expect(deps.audit.entries[0]).toEqual({
        entry: {
          action: "draft_saved",
          actorEmail: EDITOR.email,
          targetId: formId,
          ip: EDITOR.ip,
          details: { commands: 2 },
        },
        at: deps.clock.now(),
      });
      const draft = await deps.drafts.find(formId);
      expect(draft?.auditedBy).toBe(EDITOR.email);
      expect(draft?.auditedAt).toEqual(deps.clock.now());
    });

    it("audits once for saves by the same actor within five minutes, and again after six", async () => {
      const { deps, formId, pageKey, revision } = await setup();
      const add: DraftCommand[] = [{ kind: "add_field", pageKey, type: "short_text" }];

      await editDraft(deps, EDITOR, { formId, baseRevision: revision, commands: add });
      deps.clock.advance(2 * MINUTE_MS);
      await editDraft(deps, EDITOR, { formId, baseRevision: revision + 1, commands: add });
      expect(auditActions(deps)).toEqual(["draft_saved"]);
      expect((await deps.drafts.find(formId))?.revision).toBe(revision + 2);

      deps.clock.advance(6 * MINUTE_MS);
      await editDraft(deps, EDITOR, { formId, baseRevision: revision + 2, commands: add });
      expect(auditActions(deps)).toEqual(["draft_saved", "draft_saved"]);
    });

    it("audits when a different actor saves in between", async () => {
      const { deps, formId, pageKey, revision } = await setup();
      const add: DraftCommand[] = [{ kind: "add_field", pageKey, type: "short_text" }];

      await editDraft(deps, EDITOR, { formId, baseRevision: revision, commands: add });
      deps.clock.advance(MINUTE_MS);
      await editDraft(deps, OTHER, { formId, baseRevision: revision + 1, commands: add });
      deps.clock.advance(MINUTE_MS);
      await editDraft(deps, EDITOR, { formId, baseRevision: revision + 2, commands: add });

      expect(deps.audit.entries.map(({ entry }) => entry.actorEmail)).toEqual([
        EDITOR.email,
        OTHER.email,
        EDITOR.email,
      ]);
      expect((await deps.drafts.find(formId))?.updatedBy).toBe(EDITOR.email);
    });

    it("keeps the audit window anchored to the last audited save", async () => {
      const { deps, formId, pageKey, revision } = await setup();
      const add: DraftCommand[] = [{ kind: "add_field", pageKey, type: "short_text" }];
      await editDraft(deps, EDITOR, { formId, baseRevision: revision, commands: add });
      const audited = deps.clock.now();
      deps.clock.advance(3 * MINUTE_MS);
      await editDraft(deps, EDITOR, { formId, baseRevision: revision + 1, commands: add });
      expect((await deps.drafts.find(formId))?.auditedAt).toEqual(audited);
    });
  });
});

describe("getDraft", () => {
  it("returns the stored draft, or null", async () => {
    const { deps, formId } = await setup();
    expect(await getDraft(deps, formId)).toEqual(await deps.drafts.find(formId));
    expect(await getDraft(deps, fakeUuid(99))).toBeNull();
  });
});
