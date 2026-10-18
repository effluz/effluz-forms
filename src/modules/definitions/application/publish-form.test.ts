import { describe, expect, it } from "vitest";
import {
  buildDefaultRegistry,
  consentItems,
  parseDraft,
  type Version,
} from "@/shared/domain/form-model";
import type { Form } from "../domain/form";
import { publishForm, publishPreview } from "./publish-form";
import { updateSettings } from "./update-settings";
import {
  DefinitionsStore,
  EDITOR,
  fakeUuid,
  InMemoryVersionRepository,
  makeDefinitionsDeps,
  seedForm,
  withConcurrentChange,
  type FakeDefinitionsDeps,
} from "./testing/fakes";

const registry = buildDefaultRegistry();
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000999";

interface RawField {
  key: string;
  type: string;
  label: { en?: string; es?: string };
  required?: boolean;
  settings?: unknown;
}

const field = (key: string, en: string, es: string): RawField => ({
  key,
  type: "short_text",
  label: { en, es },
});

/** A synthetic bilingual document, publishable unless a field is unlabeled. */
function document(fields: RawField[]): Version {
  const parsed = parseDraft(
    {
      languages: "bilingual",
      title: { en: "Sample form", es: "Formulario de ejemplo" },
      confirmation: { screen: { en: "Thank you", es: "Gracias" } },
      pages: [{ key: "page_one", title: { en: "About", es: "Acerca de" }, fields }],
    },
    registry,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.version;
}

const NAME = field("f_name", "Name", "Nombre");
const CITY = field("f_city", "City", "Ciudad");
const PET = field("f_pet", "Pet", "Mascota");

/** Writes the draft document straight into the store, as an edit would. */
function setDraft(deps: FakeDefinitionsDeps, formId: string, doc: Version): void {
  const draft = deps.store.drafts.get(formId);
  if (!draft) throw new Error("no draft");
  deps.store.drafts.set(formId, { ...draft, document: structuredClone(doc) });
}

async function publishableForm(deps: FakeDefinitionsDeps, fields = [NAME]): Promise<string> {
  const formId = await seedForm(deps);
  setDraft(deps, formId, document(fields));
  return formId;
}

/** The publish input for a preview taken now: its number and the stored draft revision. */
function previewed(deps: FakeDefinitionsDeps, formId: string, expectedNumber: number) {
  const expectedRevision = deps.store.drafts.get(formId)?.revision;
  if (expectedRevision === undefined) throw new Error("no draft");
  return { formId, expectedNumber, expectedRevision };
}

function published(deps: FakeDefinitionsDeps) {
  return deps.audit.entries.filter((e) => e.entry.action === "form_published");
}

/** A consent field covering the nine unconditional items, not the post-plan one. */
const CONSENT: RawField = {
  key: "f_consent",
  type: "consent",
  label: { en: "Consent", es: "Consentimiento" },
  required: true,
  settings: {
    text: { en: "I agree.", es: "Acepto." },
    coveredItems: [...consentItems],
  },
};

describe("publishPreview", () => {
  it("summarizes a complete first draft: version 1, counts, no issues, no diff", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps, [NAME, CITY]);

    expect(await publishPreview(deps, formId)).toEqual({
      nextNumber: 1,
      draftRevision: deps.store.drafts.get(formId)?.revision,
      pages: 1,
      fields: 2,
      languages: "bilingual",
      issues: [],
      unchanged: false,
      diff: null,
    });
  });

  it("returns null for an unknown form", async () => {
    const deps = makeDefinitionsDeps();
    expect(await publishPreview(deps, UNKNOWN_ID)).toBeNull();
  });

  it("lists the publish issues of the draft", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps, [NAME, field("f_blank", "", "")]);

    const preview = await publishPreview(deps, formId);
    expect(preview?.issues).toEqual([{ code: "unlabeled", path: "pages/0/fields/1/label" }]);
  });

  it("requires consent item 10 only when the form uses the post plan", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps, [NAME, CONSENT]);
    expect((await publishPreview(deps, formId))?.issues).toEqual([]);

    const form = await deps.forms.findById(formId);
    if (!form) throw new Error("no form");
    const saved = await updateSettings(deps, EDITOR, {
      formId,
      settings: { ...form.settings, usePostPlan: true },
    });
    expect(saved).toEqual({ ok: true, changed: ["usePostPlan"] });

    const preview = await publishPreview(deps, formId);
    expect(preview?.issues.map((issue) => issue.code)).toEqual(["consent_checklist"]);
    expect(await publishForm(deps, EDITOR, previewed(deps, formId, 1))).toMatchObject({
      ok: false,
      code: "issues",
    });
    expect(deps.store.versions.size).toBe(0);
  });

  it("reports a missing retention period from the form settings", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    const form = deps.store.forms.get(formId);
    if (!form) throw new Error("no form");
    deps.store.forms.set(formId, { ...form, settings: { ...form.settings, retentionMonths: 0 } });

    const preview = await publishPreview(deps, formId);
    expect(preview?.issues).toEqual([{ code: "retention_missing", path: "settings/retention" }]);
  });

  it("after a change, diffs against the current version with answer counts of removed keys", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps, [NAME, CITY]);
    await publishForm(deps, EDITOR, previewed(deps, formId, 1));
    setDraft(deps, formId, document([field("f_name", "Full name", "Nombre completo"), PET]));
    deps.stats.setAnswerCounts(formId, Object.fromEntries([["f_city", 4]]));

    const preview = await publishPreview(deps, formId);
    expect(preview).toMatchObject({ nextNumber: 2, unchanged: false, issues: [] });
    expect(preview?.diff).toEqual({
      addedKeys: ["f_pet"],
      removedKeys: ["f_city"],
      changedLabels: ["f_name"],
      changedLogic: [],
      removedAnswerCounts: { f_city: 4 },
    });
  });

  it("flags a draft equal to the current version as unchanged", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    await publishForm(deps, EDITOR, previewed(deps, formId, 1));

    const preview = await publishPreview(deps, formId);
    expect(preview).toMatchObject({ nextNumber: 2, unchanged: true });
    expect(preview?.diff).toEqual({
      addedKeys: [],
      removedKeys: [],
      changedLabels: [],
      changedLogic: [],
      removedAnswerCounts: {},
    });
  });
});

describe("publishForm", () => {
  it("publishes a first version, points the form at it and refreshes the draft", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    const before = deps.store.drafts.get(formId);
    const now = new Date("2026-10-11T10:00:00Z");
    deps.clock.set(now);

    const result = await publishForm(deps, EDITOR, previewed(deps, formId, 1));
    if (!result.ok) throw new Error(result.code);
    expect(result).toEqual({
      ok: true,
      versionId: result.versionId,
      number: 1,
      publicUrl: "https://forms.example.com/f/sample-form",
    });

    expect(deps.store.versions.get(result.versionId)).toEqual({
      id: result.versionId,
      formId,
      number: 1,
      document: before?.document,
      publishedAt: now,
      publishedBy: EDITOR.email,
    });
    expect(deps.store.forms.get(formId)).toMatchObject({
      status: "published",
      currentVersionId: result.versionId,
      currentVersionNumber: 1,
    });
    expect(deps.store.drafts.get(formId)).toMatchObject({
      revision: (before?.revision ?? 0) + 1,
      document: before?.document,
      updatedBy: EDITOR.email,
      updatedAt: now,
    });
  });

  it("stamps the form updatedAt with the clock when it publishes", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    deps.clock.advance(60_000);

    await publishForm(deps, EDITOR, previewed(deps, formId, 1));

    const form = deps.store.forms.get(formId);
    expect(form?.updatedAt).toEqual(deps.clock.now());
    expect(form?.updatedAt).not.toEqual(form?.createdAt);
  });

  it("records form_published with the version number", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);

    await publishForm(deps, EDITOR, previewed(deps, formId, 1));
    expect(published(deps).map((e) => e.entry)).toEqual([
      {
        action: "form_published",
        actorEmail: EDITOR.email,
        targetId: formId,
        ip: EDITOR.ip,
        details: { number: 1 },
      },
    ]);
  });

  it("returns not_found for an unknown form", async () => {
    const deps = makeDefinitionsDeps();
    expect(
      await publishForm(deps, EDITOR, {
        formId: UNKNOWN_ID,
        expectedNumber: 1,
        expectedRevision: 1,
      }),
    ).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("refuses to publish an archived form and writes nothing", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    const form = deps.store.forms.get(formId);
    if (!form) throw new Error("no form");
    deps.store.forms.set(formId, { ...form, status: "archived" });
    const draftBefore = deps.store.drafts.get(formId);
    const auditBefore = deps.audit.entries.length;

    expect(await publishForm(deps, EDITOR, previewed(deps, formId, 1))).toEqual({
      ok: false,
      code: "archived",
    });
    expect(deps.store.versions.size).toBe(0);
    expect(deps.store.drafts.get(formId)).toEqual(draftBefore);
    expect(deps.store.forms.get(formId)?.status).toBe("archived");
    expect(deps.audit.entries).toHaveLength(auditBefore);
  });

  it("refuses a draft with issues and writes nothing", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps, [field("f_blank", "", "")]);
    const draftBefore = deps.store.drafts.get(formId);
    const auditBefore = deps.audit.entries.length;

    expect(await publishForm(deps, EDITOR, previewed(deps, formId, 1))).toEqual({
      ok: false,
      code: "issues",
      issues: [{ code: "unlabeled", path: "pages/0/fields/0/label" }],
    });
    expect(deps.store.versions.size).toBe(0);
    expect(deps.store.drafts.get(formId)).toEqual(draftBefore);
    expect(deps.store.forms.get(formId)?.status).toBe("draft");
    expect(deps.audit.entries).toHaveLength(auditBefore);
  });

  it("refuses to republish an unchanged draft", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    await publishForm(deps, EDITOR, previewed(deps, formId, 1));

    expect(await publishForm(deps, EDITOR, previewed(deps, formId, 2))).toEqual({
      ok: false,
      code: "unchanged",
    });
    expect(deps.store.versions.size).toBe(1);
  });

  it("publishes a changed draft as the next version", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    const first = await publishForm(deps, EDITOR, previewed(deps, formId, 1));
    setDraft(deps, formId, document([NAME, CITY]));

    const second = await publishForm(deps, EDITOR, previewed(deps, formId, 2));
    if (!second.ok || !first.ok) throw new Error("publish refused");
    expect(second.number).toBe(2);
    expect(deps.store.forms.get(formId)).toMatchObject({
      status: "published",
      currentVersionId: second.versionId,
      currentVersionNumber: 2,
    });
    expect(deps.store.versions.get(first.versionId)?.document).toEqual(document([NAME]));
    expect(published(deps).map((e) => e.entry.details)).toEqual([{ number: 1 }, { number: 2 }]);
  });

  it("keeps a closed form closed when it publishes a new version", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    await publishForm(deps, EDITOR, previewed(deps, formId, 1));
    const form = deps.store.forms.get(formId);
    if (!form) throw new Error("no form");
    deps.store.forms.set(formId, { ...form, status: "closed" });
    setDraft(deps, formId, document([NAME, CITY]));

    const result = await publishForm(deps, EDITOR, previewed(deps, formId, 2));
    expect(result.ok).toBe(true);
    expect(deps.store.forms.get(formId)?.status).toBe("closed");
  });

  it("returns conflict when the expected number is not the next one", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    await publishForm(deps, EDITOR, previewed(deps, formId, 1));
    setDraft(deps, formId, document([NAME, CITY]));

    expect(await publishForm(deps, EDITOR, previewed(deps, formId, 1))).toEqual({
      ok: false,
      code: "conflict",
    });
    expect(await publishForm(deps, EDITOR, previewed(deps, formId, 3))).toEqual({
      ok: false,
      code: "conflict",
    });
    expect(deps.store.versions.size).toBe(1);
    expect(published(deps)).toHaveLength(1);
  });

  it("returns conflict when the draft was saved after the preview", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    const preview = await publishPreview(deps, formId);
    if (!preview) throw new Error("no preview");
    const stored = deps.store.drafts.get(formId);
    if (!stored) throw new Error("no draft");
    deps.store.drafts.set(formId, {
      ...stored,
      revision: stored.revision + 1,
      // A blank label is a publish issue: the revision check must win anyway.
      document: document([NAME, field("f_blank", "", "")]),
    });

    expect(
      await publishForm(deps, EDITOR, {
        formId,
        expectedNumber: preview.nextNumber,
        expectedRevision: preview.draftRevision,
      }),
    ).toEqual({ ok: false, code: "conflict" });
    expect(deps.store.versions.size).toBe(0);
    expect(published(deps)).toHaveLength(0);
  });

  it("returns conflict without further writes when the number is taken at insert", async () => {
    // The fakes have no hook for losing the race, so a subclass answers number_taken.
    class RacedVersions extends InMemoryVersionRepository {
      override insert(): Promise<"number_taken"> {
        return Promise.resolve("number_taken");
      }
    }
    const store = new DefinitionsStore();
    const deps = makeDefinitionsDeps({ store, versions: new RacedVersions(store) });
    const formId = await publishableForm(deps);
    const draftBefore = deps.store.drafts.get(formId);

    expect(await publishForm(deps, EDITOR, previewed(deps, formId, 1))).toEqual({
      ok: false,
      code: "conflict",
    });
    expect(deps.store.forms.get(formId)).toMatchObject({ status: "draft", currentVersionId: null });
    expect(deps.store.drafts.get(formId)).toEqual(draftBefore);
    expect(published(deps)).toHaveLength(0);
  });

  describe("when another actor commits between the read and the lock", () => {
    /** Rewrites the stored form once, just before the use case locks it. */
    function formChange(deps: FakeDefinitionsDeps, formId: string, patch: Partial<Form>) {
      return withConcurrentChange(deps.forms, () => {
        const stored = deps.store.forms.get(formId);
        if (!stored) throw new Error("no form");
        deps.store.forms.set(formId, { ...stored, ...patch });
      });
    }

    function expectNothingWritten(
      deps: FakeDefinitionsDeps,
      formId: string,
      draftBefore: unknown,
    ): void {
      expect(deps.store.versions.size).toBe(0);
      expect(deps.store.forms.get(formId)?.currentVersionId).toBeNull();
      expect(deps.store.drafts.get(formId)).toEqual(draftBefore);
      expect(published(deps)).toHaveLength(0);
    }

    it("refuses with archived when the form was archived meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await publishableForm(deps);
      const draftBefore = deps.store.drafts.get(formId);
      const forms = formChange(deps, formId, { status: "archived", archivedAt: deps.clock.now() });

      expect(await publishForm({ ...deps, forms }, EDITOR, previewed(deps, formId, 1))).toEqual({
        ok: false,
        code: "archived",
      });
      expectNothingWritten(deps, formId, draftBefore);
      expect(deps.store.forms.get(formId)?.status).toBe("archived");
    });

    it("returns conflict when another publish moved the current version meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await publishableForm(deps);
      const forms = formChange(deps, formId, {
        status: "published",
        currentVersionId: fakeUuid(901),
        currentVersionNumber: 1,
      });

      expect(await publishForm({ ...deps, forms }, EDITOR, previewed(deps, formId, 1))).toEqual({
        ok: false,
        code: "conflict",
      });
      expect(deps.store.versions.size).toBe(0);
      expect(published(deps)).toHaveLength(0);
    });

    it("returns conflict when an editor saved the draft meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await publishableForm(deps);
      const drafts = withConcurrentChange(deps.drafts, () => {
        const stored = deps.store.drafts.get(formId);
        if (!stored) throw new Error("no draft");
        deps.store.drafts.set(formId, {
          ...stored,
          revision: stored.revision + 1,
          document: document([NAME, CITY]),
        });
      });
      const draftBefore = structuredClone(deps.store.drafts.get(formId));

      expect(await publishForm({ ...deps, drafts }, EDITOR, previewed(deps, formId, 1))).toEqual({
        ok: false,
        code: "conflict",
      });
      expect(deps.store.versions.size).toBe(0);
      expect(deps.store.drafts.get(formId)?.revision).toBe((draftBefore?.revision ?? 0) + 1);
      expect(published(deps)).toHaveLength(0);
    });

    it("writes onto the fresh form row, keeping a retention change made meanwhile", async () => {
      const deps = makeDefinitionsDeps();
      const formId = await publishableForm(deps);
      const settings = deps.store.forms.get(formId)?.settings;
      if (!settings) throw new Error("no form");
      const forms = formChange(deps, formId, { settings: { ...settings, retentionMonths: 24 } });
      const revision = deps.store.drafts.get(formId)?.revision ?? 0;

      const result = await publishForm({ ...deps, forms }, EDITOR, previewed(deps, formId, 1));

      expect(result.ok).toBe(true);
      expect(deps.store.forms.get(formId)).toMatchObject({
        status: "published",
        currentVersionNumber: 1,
        settings: { retentionMonths: 24 },
      });
      expect(deps.store.drafts.get(formId)?.revision).toBe(revision + 1);
    });
  });
});
