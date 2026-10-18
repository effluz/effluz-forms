import { describe, expect, it } from "vitest";
import type { MediaRecord } from "../domain/media";
import { enqueueMediaDelete, enqueueSubmissionMediaDeletes } from "./delete-media";
import { makeMediaDeps } from "./testing/fakes";

const SUBMISSION = "0000000b-0000-4000-8000-00000000000b";
const OTHER_SUBMISSION = "0000000d-0000-4000-8000-00000000000d";
const at = new Date("2026-10-10T12:00:00.000Z");

function row(n: number, fieldKey: string, submissionId = SUBMISSION): MediaRecord {
  return {
    id: `0000000${String(n)}-0000-4000-8000-00000000000${String(n)}`,
    submissionId,
    formId: "0000000c-0000-4000-8000-00000000000c",
    fieldKey,
    position: n,
    kind: "image",
    status: "stored",
    contentType: "image/jpeg",
    size: 10,
    stagingRef: null,
    durableKey: `forms/s/HP-0001/0${String(n)}-x.jpg`,
    providerRef: null,
    createdAt: at,
    updatedAt: at,
  };
}

describe("enqueueSubmissionMediaDeletes", () => {
  it("enqueues one media.delete per row, staff photos included", async () => {
    const deps = makeMediaDeps();
    const rows = [row(1, "photos"), row(2, "photos"), row(3, "staff-photos")];
    for (const r of [...rows, row(4, "photos", OTHER_SUBMISSION)]) deps.media.rows.set(r.id, r);

    const count = await deps.uow.run((uow) => enqueueSubmissionMediaDeletes(deps, uow, SUBMISSION));

    expect(count).toBe(3);
    const jobs = deps.queue.ofType("media.delete");
    expect(jobs.map((j) => j.payload.mediaId).sort()).toEqual(rows.map((r) => r.id).sort());
    for (const job of jobs) expect(job.opts.maxAttempts).toBe(36);
  });
});

describe("enqueueMediaDelete", () => {
  it("enqueues one media.delete for one row", async () => {
    const deps = makeMediaDeps();
    const id = "0000000a-0000-4000-8000-00000000000a";
    await deps.uow.run((uow) => enqueueMediaDelete(deps, uow, id));
    expect(deps.queue.ofType("media.delete")).toEqual([
      { type: "media.delete", payload: { mediaId: id }, opts: { maxAttempts: 36 } },
    ]);
  });
});
