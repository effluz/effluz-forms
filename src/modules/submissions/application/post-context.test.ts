import { describe, expect, it } from "vitest";
import { publishAgain } from "@/modules/definitions/application/testing/fakes";
import { newInProgress } from "../domain/in-progress";
import { storyVersion } from "../domain/testing/versions";
import { postContext } from "./post-context";
import { makeSubmissionsDeps, publishStory, type FakeSubmissionsDeps } from "./testing/fakes";

const RECORD_ID = "00000000-0000-4000-8000-0000000000aa";
const TOKEN = "00000000-0000-4000-8000-0000000000bb";
const DONE_TOKEN = "00000000-0000-4000-8000-0000000000dd";

async function storeRecord(
  deps: FakeSubmissionsDeps,
  ids: { formId: string; versionId: string },
  over: { formId?: string } = {},
) {
  const now = deps.clock.now();
  const record = newInProgress({
    id: RECORD_ID,
    formId: over.formId ?? ids.formId,
    versionId: ids.versionId,
    locale: "es",
    pageKey: "page_contact",
    submitToken: TOKEN,
    startedAt: now,
    now,
  });
  await deps.inProgress.insert(await deps.uow.begin(), record);
  return record;
}

async function storeSubmission(
  deps: FakeSubmissionsDeps,
  ids: { formId: string; versionId: string },
) {
  await deps.submissions.insert(await deps.uow.begin(), {
    id: "00000000-0000-4000-8000-0000000000cc",
    formId: ids.formId,
    versionId: ids.versionId,
    locale: "en",
    answers: {},
    consent: null,
    receivedAt: deps.clock.now(),
    reference: "ST-0007",
    submitToken: DONE_TOKEN,
  });
}

describe("postContext", () => {
  it("gives the current version and no record when the visitor has none", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const context = await postContext(deps, {
      slug: "story-form",
      state: { kind: "none" },
      submitToken: null,
    });
    expect(context.ok).toBe(true);
    if (!context.ok) return;
    expect(context.form.id).toBe(formId);
    expect(context.version.id).toBe(versionId);
    expect(context.record).toBeNull();
  });

  it("gives the record and the version it pinned, even after a newer publish", async () => {
    const deps = makeSubmissionsDeps();
    const ids = await publishStory(deps);
    const record = await storeRecord(deps, ids);
    publishAgain(deps.definitions, ids.formId, storyVersion());
    const context = await postContext(deps, {
      slug: "story-form",
      state: { kind: "record", id: record.id },
      submitToken: null,
    });
    expect(context.ok && context.version.id).toBe(ids.versionId);
    expect(context.ok && context.record?.id).toBe(record.id);
  });

  it("answers the gate when the form is not open", async () => {
    const deps = makeSubmissionsDeps();
    const { formId } = await publishStory(deps);
    const ask = (slug: string) =>
      postContext(deps, { slug, state: { kind: "none" }, submitToken: null });
    expect(await ask("nope")).toEqual({ ok: false, outcome: { kind: "gate", state: "not_found" } });
    const stored = deps.definitions.store.forms.get(formId);
    if (!stored) throw new Error("form missing");
    deps.definitions.store.forms.set(formId, { ...stored, status: "closed" });
    expect(await ask("story-form")).toEqual({
      ok: false,
      outcome: { kind: "gate", state: "closed" },
    });
  });

  it("answers submitted for a repeated Submit whose record is gone", async () => {
    const deps = makeSubmissionsDeps();
    const ids = await publishStory(deps);
    await storeSubmission(deps, ids);
    const submitted = { ok: false, outcome: { kind: "submitted", submitToken: DONE_TOKEN } };
    expect(
      await postContext(deps, {
        slug: "story-form",
        state: { kind: "record", id: RECORD_ID },
        submitToken: DONE_TOKEN,
      }),
    ).toEqual(submitted);
    expect(
      await postContext(deps, {
        slug: "story-form",
        state: { kind: "done", submitToken: DONE_TOKEN },
        submitToken: null,
      }),
    ).toEqual(submitted);
  });

  it("answers expired for a missing record whose token names no submission", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const expired = { ok: false, outcome: { kind: "expired" } };
    expect(
      await postContext(deps, {
        slug: "story-form",
        state: { kind: "record", id: RECORD_ID },
        submitToken: TOKEN,
      }),
    ).toEqual(expired);
    expect(
      await postContext(deps, {
        slug: "story-form",
        state: { kind: "record", id: RECORD_ID },
        submitToken: null,
      }),
    ).toEqual(expired);
  });

  it("refuses a record of another form or past its 24 hours as expired", async () => {
    const deps = makeSubmissionsDeps();
    const ids = await publishStory(deps);
    await storeRecord(deps, ids);
    const ask = () =>
      postContext(deps, {
        slug: "story-form",
        state: { kind: "record", id: RECORD_ID },
        submitToken: null,
      });
    expect((await ask()).ok).toBe(true);
    deps.clock.advance(24 * 3_600_000);
    expect(await ask()).toEqual({ ok: false, outcome: { kind: "expired" } });
  });

  it("refuses a record that belongs to another form", async () => {
    const deps = makeSubmissionsDeps();
    const ids = await publishStory(deps);
    await storeRecord(deps, ids, { formId: "00000000-0000-4000-8000-0000000000f0" });
    expect(
      await postContext(deps, {
        slug: "story-form",
        state: { kind: "record", id: RECORD_ID },
        submitToken: null,
      }),
    ).toEqual({ ok: false, outcome: { kind: "expired" } });
  });

  it("does not take a token of another form's submission as already submitted", async () => {
    const deps = makeSubmissionsDeps();
    const ids = await publishStory(deps);
    await storeSubmission(deps, { ...ids, formId: "00000000-0000-4000-8000-0000000000f0" });
    const context = await postContext(deps, {
      slug: "story-form",
      state: { kind: "done", submitToken: DONE_TOKEN },
      submitToken: null,
    });
    expect(context.ok).toBe(true);
  });
});
