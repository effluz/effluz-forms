import { describe, expect, it } from "vitest";
import { buildDefaultRegistry, parseDraft, type Version } from "@/shared/domain/form-model";
import {
  allocateReference,
  listPostPlanForms,
  listVersions,
  loadVersion,
  resolvePublicForm,
} from "./public-form";
import { makeDefinitionsDeps, publishAgain, seedPublished } from "./testing/fakes";

const registry = buildDefaultRegistry();

/** A publishable English document with one short text field. */
function document(title = "Stories"): Version {
  const parsed = parseDraft(
    {
      languages: "en",
      title: { en: title },
      confirmation: { screen: { en: "Thanks" } },
      pages: [
        {
          key: "page_one",
          fields: [{ key: "f_name", type: "short_text", label: { en: "Name" } }],
        },
      ],
    },
    registry,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.version;
}

describe("listVersions", () => {
  it("lists a form's versions oldest first", async () => {
    const deps = makeDefinitionsDeps();
    const { formId } = await seedPublished(deps, { slug: "twice", document: document() });
    publishAgain(deps, formId, document("Stories, second edition"));
    const other = await seedPublished(deps, { slug: "other", document: document("Other") });

    const versions = await listVersions(deps, formId);
    expect(versions.map((version) => version.number)).toEqual([1, 2]);
    expect(versions.every((version) => version.formId === formId)).toBe(true);
    expect((await listVersions(deps, other.formId)).map((version) => version.number)).toEqual([1]);
    expect(await listVersions(deps, "not-a-uuid")).toEqual([]);
  });
});

describe("listPostPlanForms", () => {
  it("lists the forms that use the post plan, any status, ordered by title", async () => {
    const deps = makeDefinitionsDeps();
    await seedPublished(deps, {
      slug: "zeta",
      document: document("Zeta stories"),
      settings: { usePostPlan: true },
    });
    await seedPublished(deps, {
      slug: "alpha",
      document: document("Alpha stories"),
      settings: { usePostPlan: true },
      status: "archived",
    });
    await seedPublished(deps, { slug: "plain", document: document("Plain stories") });

    const forms = await listPostPlanForms(deps);
    expect(forms.map((form) => form.slug)).toEqual(["alpha", "zeta"]);
  });
});

describe("resolvePublicForm", () => {
  it("returns the current version of an open form, and the state otherwise", async () => {
    const deps = makeDefinitionsDeps();
    const { formId, versionId } = await seedPublished(deps, {
      slug: "spring-stories",
      document: document(),
    });

    const open = await resolvePublicForm(deps, "spring-stories");
    expect(open.state).toBe("open");
    expect(open.state === "open" && open.version.id).toBe(versionId);
    expect(await resolvePublicForm(deps, "missing-form")).toEqual({ state: "not_found" });

    const stored = deps.store.forms.get(formId);
    if (!stored) throw new Error("seeded form missing");
    deps.store.forms.set(formId, { ...stored, status: "closed" });
    expect((await resolvePublicForm(deps, "spring-stories")).state).toBe("closed");
  });

  it("gives the open date when not yet open", async () => {
    const deps = makeDefinitionsDeps();
    await seedPublished(deps, {
      slug: "later-form",
      document: document(),
      settings: { opensAt: "2026-12-01T12:00:00.000Z" },
    });
    expect(await resolvePublicForm(deps, "later-form")).toMatchObject({
      state: "not_open_yet",
      opensAt: "2026-12-01T12:00:00.000Z",
    });
  });
});

describe("loadVersion", () => {
  it("still returns an older version after a republish", async () => {
    const deps = makeDefinitionsDeps();
    const { formId, versionId } = await seedPublished(deps, {
      slug: "spring-stories",
      document: document(),
    });
    const second = publishAgain(deps, formId, document("Stories v2"));
    expect(second).not.toBe(versionId);
    const open = await resolvePublicForm(deps, "spring-stories");
    expect(open.state === "open" && open.version.id).toBe(second);

    const first = await loadVersion(deps, versionId);
    expect(first?.document.title).toEqual({ en: "Stories" });
  });
});

describe("allocateReference", () => {
  it("hands out the prefix and a sequence per form, and refuses a closed form", async () => {
    const deps = makeDefinitionsDeps();
    const { formId } = await seedPublished(deps, {
      slug: "spring-stories",
      document: document(),
      settings: { referencePrefix: "SS" },
    });

    const [first, second] = await deps.uow.run(async (uow) => [
      await allocateReference(deps, uow, formId),
      await allocateReference(deps, uow, formId),
    ]);
    expect(first).toMatchObject({ ok: true, reference: "SS-0001" });
    expect(second).toMatchObject({ ok: true, reference: "SS-0002" });

    const stored = deps.store.forms.get(formId);
    if (!stored) throw new Error("seeded form missing");
    deps.store.forms.set(formId, { ...stored, status: "closed" });
    expect(await deps.uow.run((uow) => allocateReference(deps, uow, formId))).toEqual({
      ok: false,
      state: "closed",
    });
  });
});
