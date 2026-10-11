import { describe, expect, it } from "vitest";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { postContext } from "./post-context";
import { savePage } from "./save-page";
import { removeFile, uploadFile } from "./upload-file";
import {
  makeSubmissionsDeps,
  post as basePost,
  publishStory,
  type FakeSubmissionsDeps,
} from "./testing/fakes";

const MB = 1024 * 1024;

async function reopen(deps: FakeSubmissionsDeps, id: string) {
  const ctx = await postContext(deps, {
    slug: "story-form",
    state: { kind: "record", id },
    submitToken: null,
  });
  if (!ctx.ok) throw new Error(ctx.outcome.kind);
  return ctx;
}

/** Answers the first page so the record sits on the photos page. */
async function onPhotos(deps: FakeSubmissionsDeps) {
  const none = await postContext(deps, {
    slug: "story-form",
    state: { kind: "none" },
    submitToken: null,
  });
  if (!none.ok) throw new Error(none.outcome.kind);
  const out = await savePage(
    deps,
    none,
    basePost({
      renderedAt: new Date(deps.clock.now().getTime() - 20_000),
      answers: { f_name: "Ana Prueba", f_baby: "yes_opt" },
    }),
  );
  if (out.kind !== "show") throw new Error(out.kind);
  return reopen(deps, out.recordId);
}

const photo = (bytes: Uint8Array = fakeImage()) => ({
  fieldKey: "f_photos",
  bytes,
  renderedAt: null,
  acceptLanguage: "es",
});

describe("uploadFile", () => {
  it("stages a file for a visible upload field of the current page and counts it", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    const out = await uploadFile(deps, ctx, photo());
    expect(out).toMatchObject({
      ok: true,
      recordId: ctx.record?.id,
      file: { kind: "image" },
      count: 1,
    });
    expect(deps.inProgress.rows.get(ctx.record?.id ?? "")?.files["f_photos"]).toHaveLength(1);
  });

  it("refuses a field that is not an upload field of the current page", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const none = await postContext(deps, {
      slug: "story-form",
      state: { kind: "none" },
      submitToken: null,
    });
    if (!none.ok) throw new Error("closed");
    expect(await uploadFile(deps, none, photo())).toEqual({ ok: false, code: "not_allowed" });
    expect(await uploadFile(deps, none, { ...photo(), fieldKey: "f_name" })).toEqual({
      ok: false,
      code: "not_allowed",
    });
    expect(deps.media.staging.files.size).toBe(0);
    expect(deps.inProgress.rows.size).toBe(0);
  });

  it("refuses an upload field hidden by the record's answers", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    const id = ctx.record?.id ?? "";
    const row = deps.inProgress.rows.get(id);
    if (row)
      deps.inProgress.rows.set(id, { ...row, answers: { ...row.answers, f_baby: "no_opt" } });
    const hidden = await reopen(deps, id);
    expect(await uploadFile(deps, hidden, photo())).toEqual({ ok: false, code: "not_allowed" });
    expect(deps.media.staging.files.size).toBe(0);
  });

  it("refuses a lying, truncated or oversized file and stages nothing", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    const upload = (bytes: Uint8Array) => uploadFile(deps, ctx, photo(bytes));
    expect(await upload(new TextEncoder().encode("<!doctype html>"))).toEqual({
      ok: false,
      code: "file_wrong_type",
    });
    expect(await upload(new TextEncoder().encode("mime:image/jpeg;broken"))).toEqual({
      ok: false,
      code: "file_unreadable",
    });
    expect(await upload(fakeImage("image/jpeg", 11 * MB))).toEqual({
      ok: false,
      code: "file_too_large",
    });
    expect(deps.media.staging.files.size).toBe(0);
  });

  it("refuses the file past the field's maximum", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    for (let i = 0; i < 3; i++) await uploadFile(deps, ctx, photo());
    const fresh = await reopen(deps, ctx.record?.id ?? "");
    expect(await uploadFile(deps, fresh, photo())).toEqual({
      ok: false,
      code: "files_max",
      params: { n: 3 },
    });
    expect(deps.media.staging.files.size).toBe(3);
  });

  it("refuses on the locked record the file a stale view let through, and removes it", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const stale = await onPhotos(deps);
    for (let i = 0; i < 3; i++) await uploadFile(deps, stale, photo());
    expect(await uploadFile(deps, stale, photo())).toEqual({
      ok: false,
      code: "files_max",
      params: { n: 3 },
    });
    expect(deps.media.staging.files.size).toBe(3);
  });

  it("refuses a file that would take the record's staged files past 100 MB", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    const id = ctx.record?.id ?? "";
    const big = (n: string, size: number) => ({
      id: n,
      stagingRef: `in-progress/${id}/${n}.mp4`,
      kind: "video" as const,
      contentType: "video/mp4",
      size,
    });
    const r = deps.inProgress.rows.get(id);
    if (r)
      deps.inProgress.rows.set(id, {
        ...r,
        files: { f_photos: [big("a", 50 * MB), big("b", 46 * MB)] },
      });
    const full = await reopen(deps, id);
    expect(await uploadFile(deps, full, photo(fakeImage("image/jpeg", 5 * MB)))).toEqual({
      ok: false,
      code: "submission_too_large",
    });
    expect(deps.media.staging.files.size).toBe(0);
    expect((await uploadFile(deps, full, photo(fakeImage("image/jpeg", 3 * MB)))).ok).toBe(true);
  });

  it("refuses on the locked record a file that passed the total on a stale view, and removes it", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const stale = await onPhotos(deps);
    const id = stale.record?.id ?? "";
    const big = {
      id: "a",
      stagingRef: `in-progress/${id}/a.mp4`,
      kind: "video" as const,
      contentType: "video/mp4",
      size: 99 * MB,
    };
    const r = deps.inProgress.rows.get(id);
    if (r) deps.inProgress.rows.set(id, { ...r, files: { f_photos: [big] } });
    expect(await uploadFile(deps, stale, photo(fakeImage("image/jpeg", 2 * MB)))).toEqual({
      ok: false,
      code: "submission_too_large",
    });
    expect(deps.media.staging.files.size).toBe(0);
    expect(deps.inProgress.rows.get(id)?.files["f_photos"]).toHaveLength(1);
  });

  it("answers expired and removes the file when the record vanished before the lock", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    deps.inProgress.rows.delete(ctx.record?.id ?? "");
    expect(await uploadFile(deps, ctx, photo())).toEqual({ ok: false, code: "expired" });
    expect(deps.media.staging.files.size).toBe(0);
  });
});

describe("removeFile", () => {
  it("drops the file from the record and from staging, and reports unknown ids", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    const out = await uploadFile(deps, ctx, photo());
    if (!out.ok) throw new Error(out.code);
    expect(await removeFile(deps, ctx, out.file.id)).toBe(true);
    expect(deps.media.staging.files.size).toBe(0);
    expect(await removeFile(deps, ctx, out.file.id)).toBe(false);
  });

  it("reports false without a record", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const none = await postContext(deps, {
      slug: "story-form",
      state: { kind: "none" },
      submitToken: null,
    });
    if (!none.ok) throw new Error("closed");
    expect(await removeFile(deps, none, "x")).toBe(false);
  });
});
