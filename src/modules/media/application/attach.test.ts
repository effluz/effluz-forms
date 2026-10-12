import { describe, expect, it } from "vitest";
import type { StagedFile } from "../domain/media";
import { attachToSubmission } from "./attach";
import { makeMediaDeps } from "./testing/fakes";

describe("attachToSubmission", () => {
  it("writes one staged row and one media.upload job per file, sharing the id", async () => {
    const deps = makeMediaDeps();
    const file: StagedFile = {
      id: "00000001-0000-4000-8000-000000000001",
      stagingRef: "in-progress/r/x.jpg",
      kind: "image",
      contentType: "image/jpeg",
      size: 10,
    };
    const durableKey = "forms/s/HP-0001/01-photos.jpg";
    await deps.uow.run((uow) =>
      attachToSubmission(deps, uow, {
        submissionId: "sub-1",
        formId: "form-1",
        files: [{ fieldKey: "photos", position: 1, durableKey, file }],
      }),
    );
    expect(deps.media.rows.get(file.id)).toMatchObject({
      submissionId: "sub-1",
      formId: "form-1",
      fieldKey: "photos",
      position: 1,
      kind: "image",
      contentType: "image/jpeg",
      size: 10,
      status: "staged",
      stagingRef: "in-progress/r/x.jpg",
      durableKey,
      providerRef: null,
      createdAt: deps.clock.now(),
      updatedAt: deps.clock.now(),
    });
    expect(deps.queue.ofType("media.upload")).toEqual([
      { type: "media.upload", payload: { mediaId: file.id }, opts: { maxAttempts: 16 } },
    ]);
  });
});
