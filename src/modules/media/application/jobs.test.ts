import { describe, expect, it } from "vitest";
import { PermanentJobError } from "@/shared/application/ports/job-queue";
import { RecordingLogger, handlerContext } from "@/shared/application/testing/fakes";
import { createMediaDeleteHandler, createMediaUploadHandler } from "./jobs";
import { makeMediaDeps, type FakeMediaDeps } from "./testing/fakes";

const ID = "00000009-0000-4000-8000-000000000009";
const KEY = "forms/s/HP-0001/01-photos.jpg";

async function seed(deps: FakeMediaDeps): Promise<void> {
  await deps.staging.put(new Uint8Array([7]), "in-progress/r/x.jpg", "image/jpeg");
  await deps.media.insert(await deps.uow.begin(), {
    id: ID,
    submissionId: "sub-1",
    formId: "form-1",
    fieldKey: "photos",
    position: 1,
    kind: "image",
    status: "staged",
    contentType: "image/jpeg",
    size: 1,
    stagingRef: "in-progress/r/x.jpg",
    durableKey: KEY,
    providerRef: null,
    createdAt: deps.clock.now(),
    updatedAt: deps.clock.now(),
  });
}

describe("media.upload", () => {
  it("copies staging to durable storage, records the ref, then drops the staging copy", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    await createMediaUploadHandler(deps)({ mediaId: ID }, handlerContext());
    expect(deps.durable.files.get(KEY)?.bytes).toEqual(new Uint8Array([7]));
    expect(deps.staging.files.size).toBe(0);
    expect(deps.media.rows.get(ID)).toMatchObject({
      status: "stored",
      providerRef: KEY,
      stagingRef: null,
    });
  });

  it("is idempotent: a second run after success changes nothing", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    const handler = createMediaUploadHandler(deps);
    await handler({ mediaId: ID }, handlerContext());
    await handler({ mediaId: ID }, handlerContext());
    expect(deps.media.rows.get(ID)?.status).toBe("stored");
    expect(deps.durable.files.size).toBe(1);
  });

  it("finishes the cleanup of a run that crashed after the durable write", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    await deps.durable.put(new Uint8Array([7]), KEY, "image/jpeg");
    await deps.media.markStored(await deps.uow.begin(), ID, KEY, deps.clock.now());
    await createMediaUploadHandler(deps)({ mediaId: ID }, handlerContext());
    expect(deps.staging.files.size).toBe(0);
    expect(deps.media.rows.get(ID)).toMatchObject({ status: "stored", stagingRef: null });
  });

  it("does not write again when the row already has a provider ref", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    await deps.media.markStored(await deps.uow.begin(), ID, KEY, deps.clock.now());
    deps.durable.failPut = true;
    await createMediaUploadHandler(deps)({ mediaId: ID }, handlerContext());
    expect(deps.media.rows.get(ID)?.stagingRef).toBeNull();
  });

  it("ends quietly when the row no longer exists", async () => {
    const deps = makeMediaDeps();
    const logger = new RecordingLogger();
    await expect(
      createMediaUploadHandler(deps)({ mediaId: ID }, handlerContext({ logger })),
    ).resolves.toBeUndefined();
    expect(logger.lines).toEqual([
      { level: "info", msg: "media no longer exists", fields: { mediaId: ID } },
    ]);
  });

  it("keeps staging and the row staged on an ordinary failure, and marks failed on the last attempt", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    deps.durable.failPut = true;
    const handler = createMediaUploadHandler(deps);
    await expect(
      handler({ mediaId: ID }, handlerContext({ attempt: 1, maxAttempts: 8 })),
    ).rejects.toThrow();
    expect(deps.media.rows.get(ID)?.status).toBe("staged");
    await expect(
      handler({ mediaId: ID }, handlerContext({ attempt: 8, maxAttempts: 8 })),
    ).rejects.toThrow();
    expect(deps.media.rows.get(ID)?.status).toBe("failed");
    expect(deps.staging.files.size).toBe(1);
  });

  it("marks the row failed at once and rethrows when the staging copy is missing", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    await deps.staging.delete("in-progress/r/x.jpg");
    await expect(
      createMediaUploadHandler(deps)({ mediaId: ID }, handlerContext({ attempt: 1 })),
    ).rejects.toBeInstanceOf(PermanentJobError);
    expect(deps.media.rows.get(ID)?.status).toBe("failed");
  });

  it("fails permanently on a payload without a media id", async () => {
    const handler = createMediaUploadHandler(makeMediaDeps());
    await expect(handler({}, handlerContext())).rejects.toThrow(/mediaId/);
    await expect(handler({}, handlerContext())).rejects.toBeInstanceOf(PermanentJobError);
  });
});

describe("media.delete", () => {
  it("removes the durable copy, the staging copy and the row", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    await createMediaUploadHandler(deps)({ mediaId: ID }, handlerContext());
    await createMediaDeleteHandler(deps)({ mediaId: ID }, handlerContext());
    expect(deps.durable.files.size).toBe(0);
    expect(deps.media.rows.has(ID)).toBe(false);
  });

  it("also removes a staging copy that is still there", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    await createMediaDeleteHandler(deps)({ mediaId: ID }, handlerContext());
    expect(deps.staging.files.size).toBe(0);
    expect(deps.media.rows.has(ID)).toBe(false);
  });

  it("ends quietly when the row is already gone, and tolerates files already gone", async () => {
    const deps = makeMediaDeps();
    const handler = createMediaDeleteHandler(deps);
    await expect(handler({ mediaId: ID }, handlerContext())).resolves.toBeUndefined();
    await seed(deps);
    await deps.staging.delete("in-progress/r/x.jpg");
    await handler({ mediaId: ID }, handlerContext());
    expect(deps.media.rows.has(ID)).toBe(false);
  });

  it("keeps the row when the durable delete fails, so the retry can finish", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    await createMediaUploadHandler(deps)({ mediaId: ID }, handlerContext());
    deps.durable.delete = () => Promise.reject(new Error("storage unavailable"));
    await expect(
      createMediaDeleteHandler(deps)({ mediaId: ID }, handlerContext()),
    ).rejects.toThrow();
    expect(deps.media.rows.has(ID)).toBe(true);
  });

  it("fails permanently on a payload without a media id", async () => {
    await expect(
      createMediaDeleteHandler(makeMediaDeps())({}, handlerContext()),
    ).rejects.toBeInstanceOf(PermanentJobError);
  });
});
