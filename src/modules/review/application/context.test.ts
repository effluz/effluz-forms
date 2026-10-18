import { describe, expect, it } from "vitest";
import { EMPTY_QUERY } from "../domain/list-query";
import { listFilterFor, loadFormContext, storyLabel } from "./context";
import { seedStory } from "./testing/fixtures";
import { makeReviewDeps } from "./testing/fakes";

describe("form context", () => {
  it("loads a form's context", async () => {
    const deps = makeReviewDeps();
    const { formId } = await seedStory(deps);
    const ctx = await loadFormContext(deps, formId);
    expect(ctx?.form.id).toBe(formId);
    expect(ctx?.versions.map((v) => v.number)).toEqual([1]);
    expect(ctx?.postPlan).toBe(true);
    expect(ctx?.laterPhotosAllowed).toBe(true);

    const noLater = makeReviewDeps();
    const seeded = await seedStory(noLater, { laterPhotos: false });
    const ctxNoLater = await loadFormContext(noLater, seeded.formId);
    expect(ctxNoLater?.postPlan).toBe(true);
    expect(ctxNoLater?.laterPhotosAllowed).toBe(false);

    const off = makeReviewDeps();
    const offSeed = await seedStory(off, { postPlan: false });
    const ctxOff = await loadFormContext(off, offSeed.formId);
    expect(ctxOff?.postPlan).toBe(false);
    expect(ctxOff?.laterPhotosAllowed).toBe(false);

    expect(await loadFormContext(deps, "00000000-0000-4000-8000-000000000999")).toBeNull();
  });

  it("builds the list filter", async () => {
    const deps = makeReviewDeps();
    const { formId } = await seedStory(deps);
    const ctx = await loadFormContext(deps, formId);
    if (!ctx) throw new Error("no context");
    const versionId = ctx.versions[0]?.id;
    const query = { ...EMPTY_QUERY, version: 1, plan: "planned" as const, q: "ana" };

    expect(listFilterFor(ctx, query, deps.registry)).toEqual({
      formId,
      status: null,
      plan: "planned",
      from: null,
      to: null,
      versionId,
      media: false,
      search: { text: "ana", keys: ["f_name", "f_email"] },
    });

    const off = makeReviewDeps();
    const offSeed = await seedStory(off, { postPlan: false });
    const offCtx = await loadFormContext(off, offSeed.formId);
    if (!offCtx) throw new Error("no context");
    expect(listFilterFor(offCtx, query, off.registry).plan).toBeNull();

    expect(listFilterFor(ctx, { ...query, version: 7 }, deps.registry).versionId).toBe("none");
  });

  it("names a story by its first label answer", async () => {
    const deps = makeReviewDeps();
    const { formId } = await seedStory(deps);
    const ctx = await loadFormContext(deps, formId);
    const version = ctx?.versions[0]?.document;
    if (!version) throw new Error("no version");

    expect(storyLabel(version, deps.registry, { f_name: "  Ana Prueba " })).toBe("Ana Prueba");
    expect(storyLabel(version, deps.registry, { f_name: "   " })).toBeNull();
    expect(storyLabel(version, deps.registry, {})).toBeNull();
  });
});
