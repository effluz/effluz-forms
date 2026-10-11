import { describe, expect, it } from "vitest";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { asKey } from "@/shared/domain/form-model";
import { postContext } from "./post-context";
import { savePage } from "./save-page";
import {
  makeSubmissionsDeps,
  post as basePost,
  publishStory,
  type FakeSubmissionsDeps,
} from "./testing/fakes";
import type { PagePost } from "./fill-state";

/** A post rendered 20 seconds ago, so the minimum fill time has passed. */
function post(deps: FakeSubmissionsDeps, over: Partial<PagePost> = {}): PagePost {
  return basePost({ renderedAt: new Date(deps.clock.now().getTime() - 20_000), ...over });
}

async function context(
  deps: FakeSubmissionsDeps,
  state: Parameters<typeof postContext>[1]["state"] = { kind: "none" },
) {
  const ctx = await postContext(deps, { slug: "story-form", state, submitToken: null });
  if (!ctx.ok) throw new Error(ctx.outcome.kind);
  return ctx;
}

async function startOnPhotos(deps: FakeSubmissionsDeps): Promise<string> {
  const first = await savePage(
    deps,
    await context(deps),
    post(deps, { answers: { f_name: "Ana Prueba", f_baby: "yes_opt" } }),
  );
  if (first.kind !== "show") throw new Error(first.kind);
  return first.recordId;
}

const photo = (name: string) => ({ fieldKey: "f_photos", name, bytes: fakeImage() });

describe("savePage", () => {
  it("creates the record on the first page and moves to the next visible page", async () => {
    const deps = makeSubmissionsDeps();
    const { versionId } = await publishStory(deps);
    const rendered = new Date(deps.clock.now().getTime() - 20_000);
    const out = await savePage(
      deps,
      await context(deps),
      post(deps, {
        answers: { f_name: " Ana Prueba ", f_baby: "no_opt" },
        renderedAt: rendered,
        acceptLanguage: "en",
      }),
    );
    if (out.kind !== "show") throw new Error(out.kind);
    const record = deps.inProgress.rows.get(out.recordId);
    expect(record).toMatchObject({
      versionId,
      locale: "en",
      pageKey: "page_consent",
      answers: { f_name: "Ana Prueba", f_baby: "no_opt" },
      pending: null,
      startedAt: rendered,
    });
  });

  it("refuses a later page without a record as expired", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    expect(
      await savePage(deps, await context(deps), post(deps, { pageKey: "page_consent" })),
    ).toEqual({ kind: "expired" });
    expect(deps.inProgress.rows.size).toBe(0);
  });

  it("refuses a page the version does not have as expired", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    expect(
      await savePage(
        deps,
        await context(deps, { kind: "record", id }),
        post(deps, { pageKey: "page_nope" }),
      ),
    ).toEqual({ kind: "expired" });
  });

  it("answers expired and removes what it staged when the record vanished before the lock", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const ctx = await context(deps, { kind: "record", id });
    deps.inProgress.rows.delete(id);
    const out = await savePage(
      deps,
      ctx,
      post(deps, { pageKey: "page_baby", incoming: [photo("a.jpg")] }),
    );
    expect(out).toEqual({ kind: "expired" });
    expect(deps.media.staging.files.size).toBe(0);
  });

  it("keeps a refused Next as pending, with decode issues replacing the model's", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const out = await savePage(
      deps,
      await context(deps),
      post(deps, {
        answers: { f_email: "nope" },
        raw: { f_name: "", f_email: "nope" },
        decodeIssues: [{ code: "invalid_shape", field: asKey("f_baby") }],
      }),
    );
    if (out.kind !== "refused") throw new Error(out.kind);
    expect(out.refusedFiles).toEqual([]);
    expect(out.page).toBe(1);
    const record = deps.inProgress.rows.get(out.recordId);
    expect(record?.pageKey).toBe("page_contact");
    expect(record?.pending?.issues.map((i) => [i.field, i.code])).toEqual([
      ["f_name", "required"],
      ["f_email", "email_syntax"],
      ["f_baby", "invalid_shape"],
    ]);
    expect(record?.pending?.raw).toEqual({ f_name: "", f_email: "nope" });
    expect(record?.answers).toEqual({});
  });

  it("goes back without enforcing required, storing only valid answers", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const back = await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, { pageKey: "page_baby", action: { kind: "back" } }),
    );
    expect(back).toEqual({ kind: "show", recordId: id });
    expect(deps.inProgress.rows.get(id)).toMatchObject({ pageKey: "page_contact", pending: null });
  });

  it("stores the valid answers of a page on Back and drops the invalid ones", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, {
        pageKey: "page_contact",
        action: { kind: "back" },
        answers: { f_name: "Ana", f_email: "nope", f_baby: "yes_opt" },
      }),
    );
    expect(deps.inProgress.rows.get(id)?.answers).toEqual({ f_name: "Ana", f_baby: "yes_opt" });
  });

  it("replaces the page's stored answers: a field left empty is cleared", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, {
        pageKey: "page_contact",
        action: { kind: "back" },
        answers: { f_baby: "yes_opt" },
      }),
    );
    expect(deps.inProgress.rows.get(id)?.answers).toEqual({ f_baby: "yes_opt" });
  });

  it("builds the validation body from stored earlier answers, so a post cannot steer conditions", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    // The photos page is required while f_baby = yes_opt is stored. Posting f_baby = no_opt
    // with this page must not hide the page and skip its rules.
    const out = await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, { pageKey: "page_baby", answers: { f_baby: "no_opt", f_name: "Other" } }),
    );
    expect(out.kind).toBe("refused");
    const record = deps.inProgress.rows.get(id);
    expect(record?.pageKey).toBe("page_baby");
    expect(record?.pending?.issues.map((i) => i.field)).toEqual(["f_photos"]);
    expect(record?.answers).toEqual({ f_name: "Ana Prueba", f_baby: "yes_opt" });
  });

  it("switches language on the same page and keeps what was typed", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const out = await savePage(
      deps,
      await context(deps),
      post(deps, {
        action: { kind: "language", locale: "en" },
        answers: { f_name: "Ana" },
        raw: { f_name: "Ana", f_email: "half@" },
      }),
    );
    if (out.kind !== "show") throw new Error(out.kind);
    expect(deps.inProgress.rows.get(out.recordId)).toMatchObject({
      locale: "en",
      pageKey: "page_contact",
      answers: { f_name: "Ana" },
      pending: { pageKey: "page_contact", raw: { f_name: "Ana", f_email: "half@" }, issues: [] },
    });
  });

  it("never writes an upload input, or a key of another page, to pending.raw", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, {
        pageKey: "page_baby",
        action: { kind: "language", locale: "en" },
        raw: { f_photos: "holiday.jpg", f_name: "Other", stray: "x" },
      }),
    );
    expect(deps.inProgress.rows.get(id)?.pending?.raw).toEqual({});
    expect(JSON.stringify(deps.inProgress.rows.get(id))).not.toContain("holiday.jpg");
  });

  it("stages files posted without script, refuses more than the field allows, and removes on request", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const ctx = await context(deps, { kind: "record", id });
    const four = Array.from({ length: 4 }, (_, i) => photo(`p${String(i)}.jpg`));
    expect(
      (await savePage(deps, ctx, post(deps, { pageKey: "page_baby", incoming: four }))).kind,
    ).toBe("refused");
    expect(deps.inProgress.rows.get(id)?.pending?.issues).toEqual([
      { code: "files_max", field: "f_photos", params: { n: 3 } },
    ]);
    expect(deps.media.staging.files.size).toBe(0);

    await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, {
        pageKey: "page_baby",
        action: { kind: "language", locale: "es" },
        incoming: four.slice(0, 2),
      }),
    );
    const files = deps.inProgress.rows.get(id)?.files["f_photos"] ?? [];
    expect(files).toHaveLength(2);
    expect(deps.media.staging.files.size).toBe(2);

    const removed = files[0];
    if (!removed) throw new Error("no file");
    await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, { pageKey: "page_baby", action: { kind: "remove", fileId: removed.id } }),
    );
    expect(deps.inProgress.rows.get(id)?.files["f_photos"]?.map((f) => f.id)).toEqual([
      files[1]?.id,
    ]);
    expect(deps.media.staging.files.has(removed.stagingRef)).toBe(false);
  });

  it("counts files already staged against the field's limit", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const lang = { kind: "language", locale: "es" } as const;
    await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, {
        pageKey: "page_baby",
        action: lang,
        incoming: [photo("a.jpg"), photo("b.jpg")],
      }),
    );
    const out = await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, {
        pageKey: "page_baby",
        action: lang,
        incoming: [photo("c.jpg"), photo("d.jpg")],
      }),
    );
    expect(out.kind).toBe("show");
    expect(deps.inProgress.rows.get(id)?.files["f_photos"]).toHaveLength(2);
    expect(deps.media.staging.files.size).toBe(2);
  });

  it("ignores an empty file part, as a browser sends when no file is chosen", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const out = await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, {
        pageKey: "page_baby",
        action: { kind: "language", locale: "es" },
        incoming: [{ fieldKey: "f_photos", name: "", bytes: new Uint8Array() }],
      }),
    );
    expect(out.kind).toBe("show");
    expect(deps.media.staging.files.size).toBe(0);
  });

  it("answers a refused file by name and stores the name nowhere", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const out = await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, {
        pageKey: "page_baby",
        incoming: [
          { fieldKey: "f_photos", name: "notes.txt", bytes: new TextEncoder().encode("hello") },
        ],
      }),
    );
    expect(out).toEqual({
      kind: "refused",
      recordId: id,
      locale: "es",
      page: 2,
      refusedFiles: [{ fieldKey: "f_photos", code: "file_wrong_type", name: "notes.txt" }],
    });
    expect(JSON.stringify(deps.inProgress.rows.get(id))).not.toContain("notes.txt");
  });

  it("answers refused on a language switch only when a file was refused", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const out = await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, {
        pageKey: "page_baby",
        action: { kind: "language", locale: "en" },
        incoming: [{ fieldKey: "f_photos", name: "x.txt", bytes: new TextEncoder().encode("hi") }],
      }),
    );
    expect(out).toMatchObject({ kind: "refused", locale: "en", page: 2 });
    expect(deps.inProgress.rows.get(id)?.pending?.issues).toEqual([]);
  });

  it("refuses a file whose storage write fails, without failing the post", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    deps.media.staging.failPut = true;
    const out = await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, { pageKey: "page_baby", incoming: [photo("a.jpg")] }),
    );
    expect(out).toMatchObject({
      kind: "refused",
      refusedFiles: [{ fieldKey: "f_photos", code: "upload_failed", name: "a.jpg" }],
    });
    expect(JSON.stringify(deps.logger.lines)).not.toContain("a.jpg");
  });

  it("removes the files it staged when the save fails", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    deps.inProgress.update = () => Promise.reject(new Error("database down"));
    await expect(
      savePage(
        deps,
        await context(deps, { kind: "record", id }),
        post(deps, { pageKey: "page_baby", incoming: [photo("a.jpg")] }),
      ),
    ).rejects.toThrow("database down");
    expect(deps.media.staging.files.size).toBe(0);
  });

  describe("silent accepts", () => {
    it("deletes the record and its staged files on a filled honeypot, and answers the decoy", async () => {
      const deps = makeSubmissionsDeps();
      await publishStory(deps);
      const id = await startOnPhotos(deps);
      await savePage(
        deps,
        await context(deps, { kind: "record", id }),
        post(deps, {
          pageKey: "page_baby",
          action: { kind: "language", locale: "es" },
          incoming: [photo("a.jpg")],
        }),
      );
      expect(deps.media.staging.files.size).toBe(1);
      const out = await savePage(
        deps,
        await context(deps, { kind: "record", id }),
        post(deps, { pageKey: "page_baby", honeypot: "http://spam.example.com" }),
      );
      expect(out).toEqual({ kind: "decoy", reference: "ST-5500" });
      expect(deps.inProgress.rows.has(id)).toBe(false);
      expect(deps.media.staging.files.size).toBe(0);
    });

    it("applies to a language switch as to Next", async () => {
      const deps = makeSubmissionsDeps();
      await publishStory(deps);
      const id = await startOnPhotos(deps);
      const out = await savePage(
        deps,
        await context(deps, { kind: "record", id }),
        post(deps, {
          pageKey: "page_baby",
          action: { kind: "language", locale: "en" },
          honeypot: "x",
        }),
      );
      expect(out.kind).toBe("decoy");
      expect(deps.inProgress.rows.size).toBe(0);
    });

    it("creates nothing for a first post with a filled honeypot", async () => {
      const deps = makeSubmissionsDeps();
      await publishStory(deps);
      const out = await savePage(
        deps,
        await context(deps),
        post(deps, {
          honeypot: "x",
          answers: { f_name: "Bot", f_baby: "no_opt" },
          incoming: [photo("a.jpg")],
        }),
      );
      expect(out).toEqual({ kind: "decoy", reference: "ST-5500" });
      expect(deps.inProgress.rows.size).toBe(0);
      expect(deps.media.staging.files.size).toBe(0);
    });

    it("treats a first post faster than the minimum fill time as a decoy", async () => {
      const deps = makeSubmissionsDeps();
      await publishStory(deps);
      const out = await savePage(
        deps,
        await context(deps),
        basePost({
          renderedAt: new Date(deps.clock.now().getTime() - 1_000),
          answers: { f_name: "Ana", f_baby: "no_opt" },
        }),
      );
      expect(out.kind).toBe("decoy");
      expect(deps.inProgress.rows.size).toBe(0);
    });

    it("treats a first post without a render time as a decoy", async () => {
      const deps = makeSubmissionsDeps();
      await publishStory(deps);
      const out = await savePage(
        deps,
        await context(deps),
        basePost({ answers: { f_name: "Ana", f_baby: "no_opt" } }),
      );
      expect(out.kind).toBe("decoy");
    });

    it("measures the fill time of a later post from the record's start", async () => {
      const deps = makeSubmissionsDeps();
      await publishStory(deps);
      const first = await savePage(
        deps,
        await context(deps),
        basePost({
          renderedAt: new Date(deps.clock.now().getTime() - 3_500),
          answers: { f_name: "Ana", f_baby: "no_opt" },
        }),
      );
      if (first.kind !== "show") throw new Error(first.kind);
      const out = await savePage(
        deps,
        await context(deps, { kind: "record", id: first.recordId }),
        basePost({ pageKey: "page_consent", action: { kind: "back" } }),
      );
      expect(out).toEqual({ kind: "show", recordId: first.recordId });
    });
  });
});

describe("savePage per-submission size", () => {
  const fullRecord = (deps: FakeSubmissionsDeps, id: string, size: number) => {
    const r = deps.inProgress.rows.get(id);
    const big = {
      id: "a",
      stagingRef: `in-progress/${id}/a.mp4`,
      kind: "video" as const,
      contentType: "video/mp4",
      size,
    };
    if (r) deps.inProgress.rows.set(id, { ...r, files: { f_photos: [big] } });
  };
  const MB = 1024 * 1024;

  it("refuses a file posted without script that would pass the per-submission size", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    fullRecord(deps, id, 98 * MB);
    const out = await savePage(
      deps,
      await context(deps, { kind: "record", id }),
      post(deps, {
        pageKey: "page_baby",
        incoming: [{ fieldKey: "f_photos", name: "b.jpg", bytes: fakeImage("image/jpeg", 3 * MB) }],
      }),
    );
    expect(out).toMatchObject({
      kind: "refused",
      refusedFiles: [{ fieldKey: "f_photos", code: "submission_too_large", name: "b.jpg" }],
    });
    expect(deps.media.staging.files.size).toBe(0);
  });

  it("reports a file that lost a race for the size at the lock, with its name, and removes it", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const stale = await context(deps, { kind: "record", id });
    fullRecord(deps, id, 99 * MB);
    const out = await savePage(
      deps,
      stale,
      post(deps, {
        pageKey: "page_baby",
        incoming: [{ fieldKey: "f_photos", name: "c.jpg", bytes: fakeImage("image/jpeg", 2 * MB) }],
      }),
    );
    expect(out).toMatchObject({
      kind: "refused",
      refusedFiles: [{ fieldKey: "f_photos", code: "submission_too_large", name: "c.jpg" }],
    });
    expect(deps.media.staging.files.size).toBe(0);
    expect(deps.inProgress.rows.get(id)?.files["f_photos"]).toHaveLength(1);
  });
});
