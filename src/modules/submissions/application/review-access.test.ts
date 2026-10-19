import { describe, expect, it } from "vitest";
import type { MediaRecord } from "@/modules/media/application";
import type { Curation, Submission } from "../domain/submission";
import {
  deleteSubmission,
  findSubmission,
  findSubmissionByReference,
  writeCuration,
} from "./review-access";
import { makeSubmissionsDeps, type FakeSubmissionsDeps } from "./testing/fakes";

const at = new Date("2026-10-10T12:00:00.000Z");
const SUBMISSION_ID = "0000000b-0000-4000-8000-00000000000b";
const FORM_ID = "0000000c-0000-4000-8000-00000000000c";

function stored(over: Partial<Submission> = {}): Submission {
  return {
    id: SUBMISSION_ID,
    formId: FORM_ID,
    versionId: "0000000e-0000-4000-8000-00000000000e",
    locale: "es",
    answers: { f_name: "Ana Prueba", f_story: { nested: ["a", "b"] } },
    consent: null,
    receivedAt: at,
    reference: "ST-0001",
    submitToken: "0000000f-0000-4000-8000-00000000000f",
    ...over,
  };
}

function seed(deps: FakeSubmissionsDeps, submission = stored()): Submission {
  deps.submissions.rows.set(submission.id, submission);
  return submission;
}

function mediaRow(n: number, fieldKey: string): MediaRecord {
  return {
    id: `0000000${String(n)}-0000-4000-8000-00000000000${String(n)}`,
    submissionId: SUBMISSION_ID,
    formId: FORM_ID,
    fieldKey,
    position: n,
    kind: "image",
    status: "stored",
    contentType: "image/jpeg",
    size: 10,
    stagingRef: null,
    durableKey: `forms/s/ST-0001/0${String(n)}-x.jpg`,
    providerRef: null,
    createdAt: at,
    updatedAt: at,
  };
}

describe("review access", () => {
  it("finds a stored submission by reference with its curation", async () => {
    const deps = makeSubmissionsDeps();
    const submission = seed(deps);
    const found = await findSubmissionByReference(deps, FORM_ID, "ST-0001");
    expect(found).toEqual({
      ...submission,
      curation: {
        status: "new",
        curatedAnswers: {},
        publishedPostUrl: null,
        statusChangedBy: null,
        statusChangedAt: null,
      },
    });
    expect(await findSubmission(deps, SUBMISSION_ID)).toEqual(found);
    expect(await findSubmissionByReference(deps, FORM_ID, "ST-0002")).toBeNull();
    expect(await findSubmission(deps, "missing")).toBeNull();
  });

  it("writes curation without touching answers", async () => {
    const deps = makeSubmissionsDeps();
    seed(deps);
    const before = await findSubmission(deps, SUBMISSION_ID);
    if (!before) throw new Error("no submission");
    const curation: Curation = {
      status: "edited",
      curatedAnswers: { f_name: "Ana" },
      publishedPostUrl: null,
      statusChangedBy: "editor@example.com",
      statusChangedAt: at,
    };

    await deps.uow.run((uow) => writeCuration(deps, uow, SUBMISSION_ID, curation));

    const after = await findSubmission(deps, SUBMISSION_ID);
    expect(after?.curation).toEqual(curation);
    expect(after?.answers).toEqual(before.answers);
    expect(JSON.stringify(after?.answers)).toBe(JSON.stringify(before.answers));
  });

  it("deletes a submission and enqueues a media delete per row", async () => {
    const deps = makeSubmissionsDeps();
    seed(deps);
    for (const row of [mediaRow(1, "photos"), mediaRow(2, "photos"), mediaRow(3, "staff-photos")])
      deps.media.media.rows.set(row.id, row);

    expect(await deps.uow.run((uow) => deleteSubmission(deps, uow, SUBMISSION_ID))).toEqual({
      deleted: true,
      mediaDeletes: 3,
    });
    expect(await findSubmission(deps, SUBMISSION_ID)).toBeNull();
    expect(deps.queue.ofType("media.delete")).toHaveLength(3);

    expect(await deps.uow.run((uow) => deleteSubmission(deps, uow, SUBMISSION_ID))).toEqual({
      deleted: false,
      mediaDeletes: 0,
    });
  });
});
