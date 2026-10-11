import { describe, expect, it } from "vitest";
import { buildDefaultRegistry, parseDraft, type Version } from "@/shared/domain/form-model";
import { publishForm, publishPreview } from "./publish-form";
import {
  DefinitionsStore,
  EDITOR,
  InMemoryVersionRepository,
  makeDefinitionsDeps,
  seedForm,
  type FakeDefinitionsDeps,
} from "./testing/fakes";

const registry = buildDefaultRegistry();
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000999";

interface RawField {
  key: string;
  type: string;
  label: { en?: string; es?: string };
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

function published(deps: FakeDefinitionsDeps) {
  return deps.audit.entries.filter((e) => e.entry.action === "form_published");
}

describe("publishPreview", () => {
  it("summarizes a complete first draft: version 1, counts, no issues, no diff", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps, [NAME, CITY]);

    expect(await publishPreview(deps, formId)).toEqual({
      nextNumber: 1,
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
    await publishForm(deps, EDITOR, { formId, expectedNumber: 1 });
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
    await publishForm(deps, EDITOR, { formId, expectedNumber: 1 });

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

    const result = await publishForm(deps, EDITOR, { formId, expectedNumber: 1 });
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

  it("records form_published with the version number", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);

    await publishForm(deps, EDITOR, { formId, expectedNumber: 1 });
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
    expect(await publishForm(deps, EDITOR, { formId: UNKNOWN_ID, expectedNumber: 1 })).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("refuses a draft with issues and writes nothing", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps, [field("f_blank", "", "")]);
    const draftBefore = deps.store.drafts.get(formId);
    const auditBefore = deps.audit.entries.length;

    expect(await publishForm(deps, EDITOR, { formId, expectedNumber: 1 })).toEqual({
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
    await publishForm(deps, EDITOR, { formId, expectedNumber: 1 });

    expect(await publishForm(deps, EDITOR, { formId, expectedNumber: 2 })).toEqual({
      ok: false,
      code: "unchanged",
    });
    expect(deps.store.versions.size).toBe(1);
  });

  it("publishes a changed draft as the next version", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    const first = await publishForm(deps, EDITOR, { formId, expectedNumber: 1 });
    setDraft(deps, formId, document([NAME, CITY]));

    const second = await publishForm(deps, EDITOR, { formId, expectedNumber: 2 });
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
    await publishForm(deps, EDITOR, { formId, expectedNumber: 1 });
    const form = deps.store.forms.get(formId);
    if (!form) throw new Error("no form");
    deps.store.forms.set(formId, { ...form, status: "closed" });
    setDraft(deps, formId, document([NAME, CITY]));

    const result = await publishForm(deps, EDITOR, { formId, expectedNumber: 2 });
    expect(result.ok).toBe(true);
    expect(deps.store.forms.get(formId)?.status).toBe("closed");
  });

  it("returns conflict when the expected number is not the next one", async () => {
    const deps = makeDefinitionsDeps();
    const formId = await publishableForm(deps);
    await publishForm(deps, EDITOR, { formId, expectedNumber: 1 });
    setDraft(deps, formId, document([NAME, CITY]));

    expect(await publishForm(deps, EDITOR, { formId, expectedNumber: 1 })).toEqual({
      ok: false,
      code: "conflict",
    });
    expect(await publishForm(deps, EDITOR, { formId, expectedNumber: 3 })).toEqual({
      ok: false,
      code: "conflict",
    });
    expect(deps.store.versions.size).toBe(1);
    expect(published(deps)).toHaveLength(1);
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

    expect(await publishForm(deps, EDITOR, { formId, expectedNumber: 1 })).toEqual({
      ok: false,
      code: "conflict",
    });
    expect(deps.store.forms.get(formId)).toMatchObject({ status: "draft", currentVersionId: null });
    expect(deps.store.drafts.get(formId)).toEqual(draftBefore);
    expect(published(deps)).toHaveLength(0);
  });
});
