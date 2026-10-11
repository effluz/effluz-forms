import { describe, expect, it } from "vitest";
import { buildDefaultRegistry, parseDraft, type Version } from "@/shared/domain/form-model";
import { defaultSettings } from "../domain/settings";
import { createForm } from "./create-form";
import { EDITOR, fakeUuid, makeDefinitionsDeps, seedForm } from "./testing/fakes";

const title = { en: "Open day", es: "Día abierto" };

function sourceDocument(): Version {
  const result = parseDraft(
    {
      title: { en: "Summer camp", es: "Campamento" },
      languages: "bilingual",
      pages: [
        {
          key: "page_one",
          title: { en: "About you", es: "Sobre ti" },
          fields: [
            {
              key: "colour",
              type: "single_choice",
              label: { en: "Colour", es: "Color" },
              settings: {
                options: [
                  { key: "opt_red", label: { en: "Red", es: "Rojo" } },
                  { key: "opt_blue", label: { en: "Blue", es: "Azul" } },
                ],
              },
            },
            {
              key: "reason",
              type: "short_text",
              label: { en: "Why", es: "Por qué" },
              visibility: { field: "colour", op: "equals", value: "opt_red" },
            },
          ],
        },
      ],
      confirmation: { screen: { en: "Thanks", es: "Gracias" } },
    },
    buildDefaultRegistry(),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.version;
}

describe("createForm, blank", () => {
  it("creates a draft form with one empty page, default settings and a revision 1 draft", async () => {
    const deps = makeDefinitionsDeps();
    const result = await createForm(deps, EDITOR, { title, languages: "bilingual" });

    expect(result).toEqual({ ok: true, formId: fakeUuid(1), slug: "open-day" });
    const form = await deps.forms.findById(fakeUuid(1));
    expect(form).toMatchObject({
      slug: "open-day",
      title,
      languages: "bilingual",
      status: "draft",
      currentVersionId: null,
      currentVersionNumber: null,
      archivedAt: null,
      createdAt: deps.clock.now(),
      updatedAt: deps.clock.now(),
    });
    expect(form?.settings).toEqual(defaultSettings("open-day"));
    expect(form?.settings.referencePrefix).toBe("OD");

    const draft = await deps.drafts.find(fakeUuid(1));
    expect(draft?.revision).toBe(1);
    expect(draft?.updatedBy).toBe(EDITOR.email);
    expect(draft?.document.title).toEqual(title);
    expect(draft?.document.languages).toBe("bilingual");
    expect(draft?.document.pages).toHaveLength(1);
    expect(draft?.document.pages[0]?.fields).toEqual([]);
  });

  it("audits form_created by the actor with the ip and the language mode", async () => {
    const deps = makeDefinitionsDeps();
    await createForm(deps, EDITOR, { title, languages: "bilingual" });
    expect(deps.audit.entries).toEqual([
      {
        entry: {
          action: "form_created",
          actorEmail: EDITOR.email,
          targetId: fakeUuid(1),
          ip: EDITOR.ip,
          details: { languages: "bilingual" },
        },
        at: deps.clock.now(),
      },
    ]);
  });

  it("uses an explicit slug and derives the prefix from it", async () => {
    const deps = makeDefinitionsDeps();
    const result = await createForm(deps, EDITOR, {
      title,
      languages: "bilingual",
      slug: "spring-fair-2027",
    });
    expect(result).toMatchObject({ ok: true, slug: "spring-fair-2027" });
    const form = await deps.forms.findBySlug("spring-fair-2027");
    expect(form?.settings.referencePrefix).toBe("SF2");
  });

  it("accepts a single-language form titled only in its language", async () => {
    const deps = makeDefinitionsDeps();
    const result = await createForm(deps, EDITOR, {
      title: { es: "Becas" },
      languages: "es",
    });
    expect(result).toMatchObject({ ok: true, slug: "becas" });
  });

  it("refuses a title missing in a required language", async () => {
    const deps = makeDefinitionsDeps();
    expect(
      await createForm(deps, EDITOR, { title: { en: "Open day" }, languages: "bilingual" }),
    ).toEqual({ ok: false, code: "title_missing" });
    expect(
      await createForm(deps, EDITOR, { title: { en: "Open day", es: "  " }, languages: "es" }),
    ).toEqual({ ok: false, code: "title_missing" });
    expect(deps.store.forms.size).toBe(0);
    expect(deps.audit.entries).toEqual([]);
  });

  it("refuses reserved and malformed slugs", async () => {
    const deps = makeDefinitionsDeps();
    const input = { title, languages: "bilingual" as const };
    expect(await createForm(deps, EDITOR, { ...input, slug: "admin" })).toEqual({
      ok: false,
      code: "slug_reserved",
    });
    expect(await createForm(deps, EDITOR, { ...input, slug: "Open Day" })).toEqual({
      ok: false,
      code: "slug_format",
    });
    expect(await createForm(deps, EDITOR, { ...input, slug: "-edge" })).toEqual({
      ok: false,
      code: "slug_format",
    });
    expect(deps.store.forms.size).toBe(0);
  });

  it("reports slug_taken when another form has the slug, writing nothing", async () => {
    const deps = makeDefinitionsDeps();
    await seedForm(deps, { slug: "open-day" });
    const auditsBefore = deps.audit.entries.length;
    expect(await createForm(deps, EDITOR, { title, languages: "bilingual" })).toEqual({
      ok: false,
      code: "slug_taken",
    });
    expect(deps.store.forms.size).toBe(1);
    expect(deps.store.drafts.size).toBe(1);
    expect(deps.audit.entries).toHaveLength(auditsBefore);
  });
});

describe("createForm, duplicate", () => {
  async function seededSource() {
    const deps = makeDefinitionsDeps();
    const sourceId = await seedForm(deps, {
      title: { en: "Summer camp", es: "Campamento" },
      slug: "summer-camp",
    });
    const sourceSettings = {
      ...defaultSettings("summer-camp"),
      referencePrefix: "SUMMER",
      notificationRecipients: ["team@effluz.com"],
      notificationCadence: "daily" as const,
      digestHour: 7,
      retentionMonths: 12,
      opensAt: "2026-11-01T00:00:00.000Z",
      closesAt: "2026-12-01T00:00:00.000Z",
      allowAnotherResponse: true,
    };
    const stored = deps.store.forms.get(sourceId);
    if (!stored) throw new Error("seed failed");
    deps.store.forms.set(sourceId, { ...stored, settings: sourceSettings });
    const draft = deps.store.drafts.get(sourceId);
    if (!draft) throw new Error("seed failed");
    deps.store.drafts.set(sourceId, { ...draft, document: sourceDocument() });
    return { deps, sourceId };
  }

  const copyTitle = { en: "Copy of Summer camp", es: "Copia de Campamento" };

  it("copies the pages with new keys and the new title", async () => {
    const { deps, sourceId } = await seededSource();
    const result = await createForm(deps, EDITOR, {
      title: copyTitle,
      languages: "bilingual",
      duplicateOf: sourceId,
    });
    expect(result).toMatchObject({ ok: true, slug: "copy-of-summer-camp" });
    if (!result.ok) return;

    const copy = await deps.drafts.find(result.formId);
    const source = sourceDocument();
    expect(copy?.revision).toBe(1);
    expect(copy?.document.title).toEqual(copyTitle);
    const fields = copy?.document.pages[0]?.fields ?? [];
    expect(fields.map((f) => f.type)).toEqual(["single_choice", "short_text"]);
    expect(fields.map((f) => f.label)).toEqual(source.pages[0]?.fields.map((f) => f.label));
    const oldKeys = new Set(["page_one", "colour", "reason"]);
    expect(oldKeys.has(copy?.document.pages[0]?.key ?? "page_one")).toBe(false);
    for (const field of fields) expect(oldKeys.has(field.key)).toBe(false);
    expect(fields[1]?.visibility).toMatchObject({ field: fields[0]?.key });
  });

  it("keeps retention and cadence, resets recipients and dates, re-derives the prefix", async () => {
    const { deps, sourceId } = await seededSource();
    const result = await createForm(deps, EDITOR, {
      title: copyTitle,
      languages: "bilingual",
      slug: "winter-camp",
      duplicateOf: sourceId,
    });
    if (!result.ok) throw new Error(result.code);
    const form = await deps.forms.findById(result.formId);
    expect(form?.status).toBe("draft");
    expect(form?.settings).toEqual({
      ...defaultSettings("winter-camp"),
      notificationCadence: "daily",
      digestHour: 7,
      retentionMonths: 12,
      allowAnotherResponse: true,
      notificationRecipients: [],
      referencePrefix: "WC",
    });
    expect(form?.settings.opensAt).toBeUndefined();
    expect(form?.settings.closesAt).toBeUndefined();
    // The source is untouched.
    expect((await deps.forms.findById(sourceId))?.settings.notificationRecipients).toEqual([
      "team@effluz.com",
    ]);
  });

  it("audits form_created with duplicateOf naming the source", async () => {
    const { deps, sourceId } = await seededSource();
    const result = await createForm(deps, EDITOR, {
      title: copyTitle,
      languages: "bilingual",
      duplicateOf: sourceId,
    });
    if (!result.ok) throw new Error(result.code);
    expect(deps.audit.entries.at(-1)?.entry).toEqual({
      action: "form_created",
      actorEmail: EDITOR.email,
      targetId: result.formId,
      ip: EDITOR.ip,
      details: { languages: "bilingual", duplicateOf: sourceId },
    });
  });

  it("gives the copy the requested language mode", async () => {
    const { deps, sourceId } = await seededSource();
    const result = await createForm(deps, EDITOR, {
      title: { es: "Copia de Campamento" },
      languages: "es",
      duplicateOf: sourceId,
    });
    if (!result.ok) throw new Error(result.code);
    expect((await deps.forms.findById(result.formId))?.languages).toBe("es");
    expect((await deps.drafts.find(result.formId))?.document.languages).toBe("es");
  });

  it("reports source_not_found for an unknown or malformed source id", async () => {
    const deps = makeDefinitionsDeps();
    const input = { title, languages: "bilingual" as const };
    expect(await createForm(deps, EDITOR, { ...input, duplicateOf: fakeUuid(99) })).toEqual({
      ok: false,
      code: "source_not_found",
    });
    expect(await createForm(deps, EDITOR, { ...input, duplicateOf: "nope" })).toEqual({
      ok: false,
      code: "source_not_found",
    });
    expect(deps.store.forms.size).toBe(0);
  });
});
