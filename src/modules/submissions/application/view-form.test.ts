import { describe, expect, it } from "vitest";
import { asKey } from "@/shared/domain/form-model";
import { newInProgress, type InProgress } from "../domain/in-progress";
import type { Submission } from "../domain/submission";
import { makeSubmissionsDeps, publishStory, type FakeSubmissionsDeps } from "./testing/fakes";
import { viewForm } from "./view-form";

const RECORD_ID = "00000000-0000-4000-8000-0000000000aa";
const TOKEN = "00000000-0000-4000-8000-0000000000bb";
const DONE_TOKEN = "00000000-0000-4000-8000-0000000000dd";

async function storeRecord(
  deps: FakeSubmissionsDeps,
  over: Partial<InProgress> = {},
): Promise<InProgress> {
  const { formId, versionId } = await publishedIds(deps);
  const now = deps.clock.now();
  const record: InProgress = {
    ...newInProgress({
      id: RECORD_ID,
      formId,
      versionId,
      locale: "es",
      pageKey: "page_contact",
      submitToken: TOKEN,
      startedAt: now,
      now,
    }),
    ...over,
  };
  await deps.inProgress.insert(await deps.uow.begin(), record);
  return record;
}

async function publishedIds(deps: FakeSubmissionsDeps) {
  const [form] = [...deps.definitions.store.forms.values()];
  if (form?.currentVersionId) return { formId: form.id, versionId: form.currentVersionId };
  return publishStory(deps);
}

describe("viewForm", () => {
  it("shows page 1 fresh, in the browser's language, without a record", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const view = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "none" },
      acceptLanguage: "en-US",
      expired: false,
    });
    expect(view.screen).toBe("page");
    if (view.screen !== "page") return;
    expect(view.page).toMatchObject({
      locale: "en",
      pageKey: "page_contact",
      isFirst: true,
      isLast: false,
      hasRecord: false,
      submitToken: null,
      pending: null,
    });
    expect(view.page.position).toEqual({ n: 1, total: 2 });
    expect(view.page.renderedAt).toEqual(deps.clock.now());
  });

  it("shows a record's page on its pinned version, with the pending post", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const record = await storeRecord(deps, {
      pending: {
        pageKey: "page_contact",
        raw: { f_name: "" },
        issues: [{ code: "required" as const, field: asKey("f_name") }],
      },
    });
    const view = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "record", id: record.id },
      acceptLanguage: "en",
      expired: false,
    });
    expect(view.screen === "page" && view.page.pending?.issues).toEqual([
      { code: "required", field: "f_name" },
    ]);
    expect(view.screen === "page" && view.page.locale).toBe("es");
    expect(view.screen === "page" && view.page.hasRecord).toBe(true);
    expect(view.screen === "page" && view.page.submitToken).toBe(TOKEN);
  });

  it("ignores a pending post that belongs to another page", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    await storeRecord(deps, {
      pending: { pageKey: "page_consent", raw: {}, issues: [] },
    });
    const view = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "record", id: RECORD_ID },
      acceptLanguage: null,
      expired: false,
    });
    expect(view.screen === "page" && view.page.pending).toBeNull();
  });

  it("counts staged files as answers when it places the record in the page order", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    await storeRecord(deps, {
      pageKey: "page_baby",
      answers: { f_name: "Ana Prueba", f_baby: "yes_opt" },
      files: {
        f_photos: [
          {
            id: "00000000-0000-4000-8000-0000000000e1",
            stagingRef: "in-progress/r/a.jpg",
            kind: "image",
            contentType: "image/jpeg",
            size: 3,
          },
        ],
      },
    });
    const view = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "record", id: RECORD_ID },
      acceptLanguage: null,
      expired: false,
    });
    expect(view.screen).toBe("page");
    if (view.screen !== "page") return;
    expect(view.page.position).toEqual({ n: 2, total: 3 });
    expect(view.page).toMatchObject({ isFirst: false, isLast: false });
    expect(Object.keys(view.page.files)).toEqual(["f_photos"]);
  });

  it("shows the last page as last", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    await storeRecord(deps, { pageKey: "page_consent" });
    const view = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "record", id: RECORD_ID },
      acceptLanguage: null,
      expired: false,
    });
    expect(view.screen === "page" && view.page.isLast).toBe(true);
  });

  it("shows the gate screens and the expired screen", async () => {
    const deps = makeSubmissionsDeps();
    const { formId } = await publishStory(deps);
    const ask = (slug: string, state: Parameters<typeof viewForm>[1]["state"], expired = false) =>
      viewForm(deps, { slug, state, acceptLanguage: null, expired });

    expect(await ask("nope", { kind: "none" })).toEqual({ screen: "not_found" });
    expect(
      (await ask("story-form", { kind: "record", id: "00000000-0000-4000-8000-00000000abcd" }))
        .screen,
    ).toBe("expired");
    expect((await ask("story-form", { kind: "none" }, true)).screen).toBe("expired");

    const stored = deps.definitions.store.forms.get(formId);
    if (!stored) throw new Error("form missing");
    deps.definitions.store.forms.set(formId, { ...stored, status: "closed" });
    expect((await ask("story-form", { kind: "none" })).screen).toBe("closed");
  });

  it("shows the not-open screen with the opening date", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps, { opensAt: "2026-10-20T00:00:00Z" });
    const view = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "none" },
      acceptLanguage: null,
      expired: false,
    });
    expect(view).toMatchObject({ screen: "not_open", opensAt: "2026-10-20T00:00:00Z" });
  });

  it("treats a record of another form or past its 24 hours as expired", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    await storeRecord(deps);
    deps.clock.advance(24 * 3_600_000);
    const view = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "record", id: RECORD_ID },
      acceptLanguage: null,
      expired: false,
    });
    expect(view.screen).toBe("expired");
  });

  it("shows the confirmation for a done cookie and for a decoy", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const submission: Submission = {
      id: "00000000-0000-4000-8000-0000000000cc",
      formId,
      versionId,
      locale: "en",
      answers: {},
      consent: null,
      receivedAt: deps.clock.now(),
      reference: "ST-0007",
      submitToken: DONE_TOKEN,
    };
    await deps.submissions.insert(await deps.uow.begin(), submission);

    const done = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "done", submitToken: DONE_TOKEN },
      acceptLanguage: "es",
      expired: false,
    });
    expect(done).toMatchObject({ screen: "confirmation", reference: "ST-0007", locale: "en" });

    const decoy = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "decoy", reference: "ST-4321" },
      acceptLanguage: "es",
      expired: false,
    });
    expect(decoy).toMatchObject({ screen: "confirmation", reference: "ST-4321", locale: "es" });
  });

  it("does not show another form's confirmation under this slug", async () => {
    const deps = makeSubmissionsDeps();
    const { versionId } = await publishStory(deps);
    await deps.submissions.insert(await deps.uow.begin(), {
      id: "00000000-0000-4000-8000-0000000000cc",
      formId: "00000000-0000-4000-8000-0000000000f0",
      versionId,
      locale: "en",
      answers: {},
      consent: null,
      receivedAt: deps.clock.now(),
      reference: "OT-0001",
      submitToken: DONE_TOKEN,
    });
    const view = await viewForm(deps, {
      slug: "story-form",
      state: { kind: "done", submitToken: DONE_TOKEN },
      acceptLanguage: null,
      expired: false,
    });
    expect(view.screen).toBe("page");
  });
});
