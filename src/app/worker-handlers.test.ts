import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { MEDIA_JOB_TYPES } from "@/modules/media/application";
import { EMAIL_JOB_TYPES } from "@/modules/notifications/application";
import { makeNotificationsDeps } from "@/modules/notifications/application/testing/fakes";
import {
  postContext,
  savePage,
  submitForm,
  uploadFile,
  type PagePost,
} from "@/modules/submissions/application";
import {
  makeSubmissionsDeps,
  post,
  publishStory,
  type FakeSubmissionsDeps,
} from "@/modules/submissions/application/testing/fakes";
import { handlerContext } from "@/shared/application/testing/fakes";
import { consentTextVersion } from "@/shared/domain/form-model";
import type { LocalizedText } from "@/shared/domain/localized-text";
import { makeMediaDeps } from "@/modules/media/application/testing/fakes";
import { RECURRING, workerHandlers } from "./worker-handlers";

const store = { pruneSucceeded: () => Promise.resolve(0) };

async function contextFor(deps: FakeSubmissionsDeps, id: string | null, submitToken?: string) {
  const ctx = await postContext(deps, {
    slug: "story-form",
    state: id === null ? { kind: "none" } : { kind: "record", id },
    submitToken: submitToken ?? null,
  });
  if (!ctx.ok) throw new Error("closed");
  return ctx;
}

describe("workerHandlers", () => {
  it("registers every job type of this release that has a handler", () => {
    const handlers = workerHandlers({
      store,
      pool: {} as Pool,
      media: makeMediaDeps(),
      notifications: makeNotificationsDeps(),
      submissions: makeSubmissionsDeps(),
    });
    expect(Object.keys(handlers).sort()).toEqual([
      "email.staff_notification",
      "email.submitter_confirmation",
      "identity.cleanup",
      "jobs.cleanup",
      "media.delete",
      "media.upload",
    ]);
    expect(RECURRING).toEqual([
      { type: "jobs.cleanup", period: "daily" },
      { type: "identity.cleanup", period: "daily" },
    ]);
  });

  it("has a handler for every job type the use cases enqueue", async () => {
    const submissions = makeSubmissionsDeps();
    const { versionId } = await publishStory(submissions);
    const version = await submissions.definitions.versions.findById(versionId);
    const consentField = version?.document.pages
      .flatMap((page) => page.fields)
      .find((field) => field.key === "f_consent");
    const consentText = (consentField?.settings as { text: LocalizedText } | undefined)?.text;
    if (!consentText) throw new Error("the story form has no consent field");
    const first = await savePage(
      submissions,
      await contextFor(submissions, null),
      post({
        answers: { f_name: "Ana Prueba", f_email: "family@example.com", f_baby: "yes_opt" },
        renderedAt: submissions.clock.now(),
      }),
    );
    if (first.kind !== "show") throw new Error(first.kind);
    const id = first.recordId;
    const up = await uploadFile(submissions, await contextFor(submissions, id), {
      fieldKey: "f_photos",
      bytes: fakeImage(),
      renderedAt: null,
      acceptLanguage: "es",
    });
    if (!up.ok) throw new Error(up.code);
    const next = await savePage(
      submissions,
      await contextFor(submissions, id),
      post({ pageKey: "page_baby", state: { kind: "record", id } }),
    );
    if (next.kind !== "show") throw new Error(next.kind);
    submissions.clock.advance(60_000);
    const token = submissions.inProgress.rows.get(id)?.submitToken ?? undefined;
    const submitPost: PagePost = post({
      pageKey: "page_consent",
      action: { kind: "submit" },
      answers: { f_consent: { accepted: true, textVersion: consentTextVersion(consentText) } },
      state: { kind: "record", id },
      submitToken: token ?? null,
    });
    const out = await submitForm(submissions, await contextFor(submissions, id, token), submitPost);
    expect(out.kind).toBe("submitted");

    const handlers = workerHandlers({
      store,
      pool: {} as Pool,
      media: submissions.media,
      notifications: makeNotificationsDeps(),
      submissions,
    });
    const types = new Set(submissions.queue.enqueued.map((j) => j.type));
    expect(types.size).toBeGreaterThan(0);
    for (const type of types) expect(Object.keys(handlers)).toContain(type);
    // The two producers' vocabularies are what the worker registers.
    for (const type of [...Object.values(MEDIA_JOB_TYPES), ...Object.values(EMAIL_JOB_TYPES)])
      expect(Object.keys(handlers)).toContain(type);
  });

  it("jobs.cleanup removes an expired record and its staged files, and stores no submission", async () => {
    const submissions = makeSubmissionsDeps();
    await publishStory(submissions);
    const none = await postContext(submissions, {
      slug: "story-form",
      state: { kind: "none" },
      submitToken: null,
    });
    if (!none.ok) throw new Error("closed");
    const first = await savePage(
      submissions,
      none,
      post({ answers: { f_name: "Ana Prueba", f_baby: "yes_opt" } }),
    );
    if (first.kind !== "show") throw new Error(first.kind);
    const ctx = await postContext(submissions, {
      slug: "story-form",
      state: { kind: "record", id: first.recordId },
      submitToken: null,
    });
    if (!ctx.ok) throw new Error("expired");
    await uploadFile(submissions, ctx, {
      fieldKey: "f_photos",
      bytes: fakeImage(),
      renderedAt: null,
      acceptLanguage: "es",
    });
    expect(submissions.media.staging.files.size).toBe(1);

    const handlers = workerHandlers({
      store,
      pool: {} as Pool,
      media: submissions.media,
      notifications: makeNotificationsDeps(),
      submissions,
    });
    const cleanup = handlers["jobs.cleanup"];
    if (!cleanup) throw new Error("jobs.cleanup is not registered");
    submissions.clock.advance(24 * 60 * 60 * 1000);
    await cleanup({}, handlerContext({ clock: submissions.clock }));
    expect(submissions.inProgress.rows.size).toBe(0);
    expect(submissions.media.staging.files.size).toBe(0);
    expect(submissions.submissions.rows.size).toBe(0);
  });

  it("jobs.cleanup sweeps a staging prefix that outlived its record", async () => {
    const submissions = makeSubmissionsDeps();
    const orphan = "in-progress/00000000-0000-4000-8000-0000000000b1/f1.jpg";
    await submissions.media.staging.put(fakeImage(), orphan, "image/jpeg");
    const handlers = workerHandlers({
      store,
      pool: {} as Pool,
      media: submissions.media,
      notifications: makeNotificationsDeps(),
      submissions,
    });
    const cleanup = handlers["jobs.cleanup"];
    if (!cleanup) throw new Error("jobs.cleanup is not registered");
    submissions.clock.advance(24 * 60 * 60 * 1000);
    await cleanup({}, handlerContext({ clock: submissions.clock }));
    expect(submissions.media.staging.files.has(orphan)).toBe(false);
  });
});
