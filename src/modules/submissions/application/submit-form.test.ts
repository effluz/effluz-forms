import { describe, expect, it } from "vitest";
import { allocateReference } from "@/modules/definitions/application";
import { publishAgain, seedPublished } from "@/modules/definitions/application/testing/fakes";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { consentTextVersion, type Version } from "@/shared/domain/form-model";
import { CONSENT_TEXT, storyVersion } from "../domain/testing/versions";
import type { PagePost } from "./fill-state";
import { postContext } from "./post-context";
import { savePage } from "./save-page";
import { submitForm } from "./submit-form";
import { makeSubmissionsDeps, post, publishStory, type FakeSubmissionsDeps } from "./testing/fakes";
import { uploadFile } from "./upload-file";

const consent = { accepted: true, textVersion: consentTextVersion(CONSENT_TEXT) };

async function ctxOf(deps: FakeSubmissionsDeps, id: string | null, submitToken?: string | null) {
  const ctx = await postContext(deps, {
    slug: "story-form",
    state: id === null ? { kind: "none" } : { kind: "record", id },
    submitToken: submitToken ?? null,
  });
  if (!ctx.ok) throw new Error(ctx.outcome.kind);
  return ctx;
}

async function reachConsent(deps: FakeSubmissionsDeps): Promise<string> {
  const first = await savePage(
    deps,
    await ctxOf(deps, null),
    post({
      answers: { f_name: "Ana Prueba", f_email: "family@example.com", f_baby: "yes_opt" },
      renderedAt: deps.clock.now(),
    }),
  );
  if (first.kind !== "show") throw new Error(first.kind);
  const id = first.recordId;
  for (let i = 0; i < 2; i += 1) {
    const up = await uploadFile(deps, await ctxOf(deps, id), {
      fieldKey: "f_photos",
      bytes: fakeImage(),
      renderedAt: null,
      acceptLanguage: "es",
    });
    if (!up.ok) throw new Error(up.code);
  }
  const next = await savePage(
    deps,
    await ctxOf(deps, id),
    post({ pageKey: "page_baby", state: { kind: "record", id } }),
  );
  if (next.kind !== "show") throw new Error(next.kind);
  deps.clock.advance(60_000);
  return id;
}

const submitPost = (id: string, over: Partial<PagePost> = {}): PagePost =>
  post({
    pageKey: "page_consent",
    action: { kind: "submit" },
    answers: { f_consent: consent },
    state: { kind: "record", id },
    ...over,
  });

async function submit(deps: FakeSubmissionsDeps, id: string, over: Partial<PagePost> = {}) {
  const token = deps.inProgress.rows.get(id)?.submitToken ?? null;
  return submitForm(
    deps,
    await ctxOf(deps, id, token),
    submitPost(id, { submitToken: token, ...over }),
  );
}

describe("submitForm", () => {
  it("stores the submission, media rows and jobs in one go and deletes the record", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const id = await reachConsent(deps);
    const token = deps.inProgress.rows.get(id)?.submitToken;
    const out = await submit(deps, id);
    expect(out).toEqual({ kind: "submitted", submitToken: token });
    const [s] = [...deps.submissions.rows.values()];
    expect(s).toMatchObject({
      formId,
      versionId,
      locale: "es",
      reference: "ST-0001",
      submitToken: token,
    });
    expect(Object.keys(s?.answers ?? {}).sort()).toEqual([
      "f_baby",
      "f_consent",
      "f_email",
      "f_name",
      "f_photos",
    ]);
    expect(s?.consent).toEqual({
      fieldKey: "f_consent",
      textVersion: consent.textVersion,
      acceptedAt: deps.clock.now(),
    });
    const media = [...deps.media.media.rows.values()];
    expect(media.map((m) => [m.position, m.durableKey])).toEqual([
      [1, "forms/story-form/ST-0001/01-photos.jpg"],
      [2, "forms/story-form/ST-0001/02-photos.jpg"],
    ]);
    expect(deps.queue.enqueued.map((j) => j.type).sort()).toEqual([
      "email.staff_notification",
      "email.submitter_confirmation",
      "media.upload",
      "media.upload",
    ]);
    expect(deps.queue.enqueued.every((j) => Object.keys(j.payload).length === 1)).toBe(true);
    expect(deps.inProgress.rows.has(id)).toBe(false);
    // The attached staging copies stay until media.upload moves them.
    expect(deps.media.staging.files.size).toBe(2);
    expect(deps.logger.lines.at(-1)).toMatchObject({
      msg: "submission received",
      fields: { formId, submissionId: s?.id },
    });
    expect(JSON.stringify(deps.logger.lines)).not.toMatch(/@|Ana/);
  });

  it("answers a repeated submit with the same confirmation, no second submission and no second reference", async () => {
    const deps = makeSubmissionsDeps();
    const { formId } = await publishStory(deps);
    const id = await reachConsent(deps);
    const token = deps.inProgress.rows.get(id)?.submitToken ?? null;
    await submit(deps, id);
    const updatedAt = deps.definitions.store.forms.get(formId)?.updatedAt;
    const again = await postContext(deps, {
      slug: "story-form",
      state: { kind: "record", id },
      submitToken: token,
    });
    expect(again).toEqual({ ok: false, outcome: { kind: "submitted", submitToken: token } });
    expect(deps.submissions.rows.size).toBe(1);
    expect(deps.definitions.store.forms.get(formId)?.updatedAt).toEqual(updatedAt);
    const uow = await deps.uow.begin();
    expect(await allocateReference(deps.definitions, uow, formId)).toMatchObject({
      ok: true,
      reference: "ST-0002",
    });
  });

  it("answers a submit whose record went under the lock with the confirmation", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    const token = deps.inProgress.rows.get(id)?.submitToken ?? null;
    const ctx = await ctxOf(deps, id, token);
    await submit(deps, id);
    expect(await submitForm(deps, ctx, submitPost(id, { submitToken: token }))).toEqual({
      kind: "submitted",
      submitToken: token,
    });
    expect(deps.submissions.rows.size).toBe(1);
  });

  it("looks the submit token up inside the intake's unit of work, never on another connection", async () => {
    for (const recordGone of [false, true]) {
      const deps = makeSubmissionsDeps();
      await publishStory(deps);
      const id = await reachConsent(deps);
      const token = deps.inProgress.rows.get(id)?.submitToken ?? null;
      const ctx = await ctxOf(deps, id, token);
      // A double click: the first Submit committed and deleted the row.
      if (recordGone) deps.inProgress.rows.delete(id);
      const real = deps.submissions.findBySubmitToken.bind(deps.submissions);
      const withUow: boolean[] = [];
      deps.submissions.findBySubmitToken = (t, uow) => {
        withUow.push(uow !== undefined);
        return real(t, uow);
      };
      await submitForm(deps, ctx, submitPost(id, { submitToken: token }));
      expect(withUow.length).toBeGreaterThan(0);
      expect(withUow.every(Boolean)).toBe(true);
    }
  });

  it("answers a token already used with the confirmation before taking a reference", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const id = await reachConsent(deps);
    const token = deps.inProgress.rows.get(id)?.submitToken ?? "";
    await deps.submissions.insert(await deps.uow.begin(), {
      id: "00000000-0000-4000-8000-0000000000ee",
      formId,
      versionId,
      locale: "es",
      answers: {},
      consent: null,
      receivedAt: deps.clock.now(),
      reference: "ST-0009",
      submitToken: token,
    });
    const updatedAt = deps.definitions.store.forms.get(formId)?.updatedAt;
    expect(await submit(deps, id)).toEqual({ kind: "submitted", submitToken: token });
    expect(deps.submissions.rows.size).toBe(1);
    expect(deps.media.media.rows.size).toBe(0);
    expect(deps.queue.ofType("media.upload")).toEqual([]);
    expect(deps.definitions.store.forms.get(formId)?.updatedAt).toEqual(updatedAt);
    const uow = await deps.uow.begin();
    expect(await allocateReference(deps.definitions, uow, formId)).toMatchObject({
      ok: true,
      reference: "ST-0001",
    });
  });

  it("silently accepts a filled honeypot or a too-fast submission, storing nothing", async () => {
    for (const variant of ["honeypot", "fast"] as const) {
      const deps = makeSubmissionsDeps();
      await publishStory(deps);
      const id = await reachConsent(deps);
      if (variant === "fast") {
        const r = deps.inProgress.rows.get(id);
        if (r)
          deps.inProgress.rows.set(id, {
            ...r,
            startedAt: new Date(deps.clock.now().getTime() - 2_000),
          });
      }
      const out = await submit(
        deps,
        id,
        variant === "honeypot" ? { honeypot: "http://spam.example" } : {},
      );
      expect(out).toEqual({ kind: "decoy", reference: "ST-5500" });
      expect(deps.submissions.rows.size).toBe(0);
      expect(deps.media.media.rows.size).toBe(0);
      expect(deps.queue.enqueued).toEqual([]);
      expect(deps.inProgress.rows.size).toBe(0);
      expect(deps.media.staging.files.size).toBe(0);
    }
  });

  it("completes against the pinned version after a republish", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const id = await reachConsent(deps);
    const v2: Version = { ...storyVersion(), title: { en: "Stories 2", es: "Historias 2" } };
    publishAgain(deps.definitions, formId, v2);
    await submit(deps, id);
    expect([...deps.submissions.rows.values()][0]?.versionId).toBe(versionId);
  });

  it("discards answers and files of a page hidden by a changed answer", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    const staged = [...deps.media.staging.files.keys()];
    expect(staged).toHaveLength(2);
    await savePage(
      deps,
      await ctxOf(deps, id),
      post({ pageKey: "page_consent", action: { kind: "back" }, state: { kind: "record", id } }),
    );
    await savePage(
      deps,
      await ctxOf(deps, id),
      post({ pageKey: "page_baby", action: { kind: "back" }, state: { kind: "record", id } }),
    );
    await savePage(
      deps,
      await ctxOf(deps, id),
      post({
        answers: { f_name: "Ana Prueba", f_email: "family@example.com", f_baby: "no_opt" },
        state: { kind: "record", id },
      }),
    );
    await submit(deps, id);
    const [s] = [...deps.submissions.rows.values()];
    expect(s?.answers).not.toHaveProperty("f_photos");
    expect(deps.media.media.rows.size).toBe(0);
    expect(deps.media.staging.files.size).toBe(0);
    expect(deps.queue.ofType("media.upload")).toEqual([]);
  });

  it("refuses an invalid last page, keeping what was typed on it", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    const out = await submit(deps, id, { answers: {}, raw: { f_consent: "" } });
    expect(out).toMatchObject({ kind: "refused", recordId: id, page: 3, refusedFiles: [] });
    expect(deps.inProgress.rows.get(id)).toMatchObject({
      pageKey: "page_consent",
      pending: {
        pageKey: "page_consent",
        raw: { f_consent: "" },
        issues: [{ field: "f_consent" }],
      },
    });
    expect(deps.submissions.rows.size).toBe(0);
    expect(deps.queue.enqueued).toEqual([]);
  });

  it("returns to the first page with a problem when the whole submission is invalid", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    const r = deps.inProgress.rows.get(id);
    if (r)
      deps.inProgress.rows.set(id, {
        ...r,
        answers: { ...r.answers, f_name: undefined },
        files: {},
      });
    expect(await submit(deps, id)).toMatchObject({
      kind: "refused",
      recordId: id,
      page: 1,
      refusedFiles: [],
    });
    expect(deps.inProgress.rows.get(id)).toMatchObject({
      pageKey: "page_contact",
      pending: {
        pageKey: "page_contact",
        raw: {},
        issues: [{ code: "required", field: "f_name" }],
      },
    });
    expect(deps.submissions.rows.size).toBe(0);
  });

  it("treats an expired record as expired at submit", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    const ctx = await ctxOf(deps, id);
    deps.clock.advance(24 * 60 * 60 * 1000);
    expect(await submitForm(deps, ctx, submitPost(id))).toEqual({ kind: "expired" });
    expect(deps.submissions.rows.size).toBe(0);
  });

  it("refuses a form closed before the reference is taken, storing nothing", async () => {
    const deps = makeSubmissionsDeps();
    const { formId } = await publishStory(deps);
    const id = await reachConsent(deps);
    const ctx = await ctxOf(deps, id, deps.inProgress.rows.get(id)?.submitToken ?? null);
    const stored = deps.definitions.store.forms.get(formId);
    if (stored) deps.definitions.store.forms.set(formId, { ...stored, status: "closed" });
    expect(await submitForm(deps, ctx, submitPost(id))).toEqual({
      kind: "gate",
      state: "closed",
    });
    expect(deps.submissions.rows.size).toBe(0);
    expect(deps.queue.enqueued).toEqual([]);
    expect(deps.inProgress.rows.has(id)).toBe(true);
  });

  it("enqueues no staff notification for a daily cadence or no recipients", async () => {
    const variants = [{ notificationCadence: "daily" as const }, { notificationRecipients: [] }];
    for (const settings of variants) {
      const deps = makeSubmissionsDeps();
      await publishStory(deps, settings);
      const id = await reachConsent(deps);
      await submit(deps, id);
      expect(deps.queue.ofType("email.staff_notification")).toEqual([]);
      expect(deps.queue.ofType("email.submitter_confirmation")).toHaveLength(1);
    }
  });

  it("enqueues no submitter confirmation when no submitter address was answered", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    const r = deps.inProgress.rows.get(id);
    if (r) deps.inProgress.rows.set(id, { ...r, answers: { ...r.answers, f_email: undefined } });
    expect((await submit(deps, id)).kind).toBe("submitted");
    expect(deps.queue.ofType("email.submitter_confirmation")).toEqual([]);
    expect(deps.queue.ofType("email.staff_notification")).toHaveLength(1);
  });
});

describe("submitForm races and one-page forms", () => {
  // The fake unit of work cannot roll back: the reference given back is proved against
  // Postgres in tests/integration/submissions/intake.test.ts.
  it("answers submitted and enqueues nothing when the insert meets the token", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    const token = deps.inProgress.rows.get(id)?.submitToken ?? null;
    deps.submissions.insert = () => Promise.resolve("duplicate_token");
    expect(await submit(deps, id)).toEqual({ kind: "submitted", submitToken: token });
    expect(deps.media.media.rows.size).toBe(0);
    expect(deps.queue.enqueued).toEqual([]);
    expect(deps.inProgress.rows.has(id)).toBe(true);
  });

  it("discards the post's staged files and rethrows when the intake fails", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    deps.queue.failAt = 0;
    await expect(submit(deps, id)).rejects.toThrow("injected enqueue failure");
    expect(deps.inProgress.rows.has(id)).toBe(true);
    expect(deps.media.staging.files.size).toBe(2);
  });

  async function publishOnePage(deps: FakeSubmissionsDeps) {
    const story = storyVersion();
    const consentPage = story.pages[2];
    if (!consentPage) throw new Error("story has a consent page");
    await seedPublished(deps.definitions, {
      slug: "one-page",
      document: { ...story, pages: [consentPage] },
      settings: { referencePrefix: "OP", notificationRecipients: ["stories@example.com"] },
    });
  }

  const onePagePost = (deps: FakeSubmissionsDeps, over: Partial<PagePost> = {}) =>
    post({
      pageKey: "page_consent",
      action: { kind: "submit" },
      answers: { f_consent: consent },
      renderedAt: new Date(deps.clock.now().getTime() - 60_000),
      ...over,
    });

  async function onePageContext(deps: FakeSubmissionsDeps) {
    const ctx = await postContext(deps, {
      slug: "one-page",
      state: { kind: "none" },
      submitToken: null,
    });
    if (!ctx.ok) throw new Error(ctx.outcome.kind);
    return ctx;
  }

  it("submits a one-page form from page 1 without a record", async () => {
    const deps = makeSubmissionsDeps();
    await publishOnePage(deps);
    const out = await submitForm(deps, await onePageContext(deps), onePagePost(deps));
    expect(out.kind).toBe("submitted");
    const [s] = [...deps.submissions.rows.values()];
    expect(s).toMatchObject({ reference: "OP-0001", locale: "es" });
    expect(out).toEqual({ kind: "submitted", submitToken: s?.submitToken });
    expect(deps.inProgress.rows.size).toBe(0);
    expect(deps.queue.ofType("email.staff_notification")).toHaveLength(1);
  });

  it("measures a one-page form's fill time from the render and keeps a refusal as a record", async () => {
    const deps = makeSubmissionsDeps();
    await publishOnePage(deps);
    const fast = await submitForm(
      deps,
      await onePageContext(deps),
      onePagePost(deps, { renderedAt: null }),
    );
    expect(fast).toEqual({ kind: "decoy", reference: "OP-5500" });
    expect(deps.inProgress.rows.size).toBe(0);

    const out = await submitForm(
      deps,
      await onePageContext(deps),
      onePagePost(deps, { answers: {} }),
    );
    if (out.kind !== "refused") throw new Error(out.kind);
    expect(deps.inProgress.rows.get(out.recordId)).toMatchObject({
      pageKey: "page_consent",
      pending: { issues: [{ field: "f_consent" }] },
    });
    expect(deps.submissions.rows.size).toBe(0);
  });

  it("refuses a Submit without a record on page 1 of a multi-page form as expired", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const out = await submitForm(
      deps,
      await ctxOf(deps, null),
      post({
        action: { kind: "submit" },
        answers: { f_name: "Ana Prueba", f_baby: "no_opt" },
        renderedAt: new Date(deps.clock.now().getTime() - 60_000),
      }),
    );
    expect(out).toEqual({ kind: "expired" });
    expect(deps.submissions.rows.size).toBe(0);
    expect(deps.inProgress.rows.size).toBe(0);
  });

  it("refuses a later page without a record as expired", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    expect(
      await submitForm(deps, await ctxOf(deps, null), submitPost("x", { state: { kind: "none" } })),
    ).toEqual({
      kind: "expired",
    });
  });
});

describe("a filled honeypot on any post", () => {
  it("deletes the record and its staged files on Next, Back and the language switch, and answers the decoy", async () => {
    const actions = [
      { kind: "next" },
      { kind: "back" },
      { kind: "language", locale: "en" },
    ] as const;
    for (const action of actions) {
      const deps = makeSubmissionsDeps();
      await publishStory(deps);
      const id = await reachConsent(deps);
      expect(deps.media.staging.files.size).toBe(2);
      const out = await savePage(
        deps,
        await ctxOf(deps, id),
        post({ pageKey: "page_consent", action, honeypot: "x", state: { kind: "record", id } }),
      );
      expect(out).toEqual({ kind: "decoy", reference: "ST-5500" });
      expect(deps.inProgress.rows.size).toBe(0);
      expect(deps.media.staging.files.size).toBe(0);
      expect(deps.submissions.rows.size).toBe(0);
    }
  });

  it("stores nothing for a filled honeypot on page 1, where there is no record yet", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    expect(
      await savePage(
        deps,
        await ctxOf(deps, null),
        post({ answers: { f_name: "Ana Prueba", f_baby: "no_opt" }, honeypot: "x" }),
      ),
    ).toEqual({ kind: "decoy", reference: "ST-5500" });
    expect(deps.inProgress.rows.size).toBe(0);
  });
});
