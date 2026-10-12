import { describe, expect, it } from "vitest";
import { FakeUnitOfWorkFactory, InMemoryJobQueue } from "@/shared/application/testing/fakes";
import { enqueueSubmissionEmails } from "./enqueue";

describe("enqueueSubmissionEmails", () => {
  it("enqueues only the messages asked for, with the submission id as the only payload", async () => {
    const queue = new InMemoryJobQueue();
    const uow = await new FakeUnitOfWorkFactory().begin();
    await enqueueSubmissionEmails(queue, uow, {
      submissionId: "s1",
      submitterConfirmation: false,
      staffNotification: true,
    });
    expect(queue.enqueued).toEqual([
      {
        type: "email.staff_notification",
        payload: { submissionId: "s1" },
        opts: { maxAttempts: 16 },
      },
    ]);
  });

  it("enqueues the confirmation first when both are asked for", async () => {
    const queue = new InMemoryJobQueue();
    const uow = await new FakeUnitOfWorkFactory().begin();
    await enqueueSubmissionEmails(queue, uow, {
      submissionId: "s1",
      submitterConfirmation: true,
      staffNotification: true,
    });
    expect(queue.enqueued.map((j) => j.type)).toEqual([
      "email.submitter_confirmation",
      "email.staff_notification",
    ]);
  });

  it("lets the backoff reach its one-hour cap before a message goes dead", async () => {
    const queue = new InMemoryJobQueue();
    const uow = await new FakeUnitOfWorkFactory().begin();
    await enqueueSubmissionEmails(queue, uow, {
      submissionId: "s1",
      submitterConfirmation: true,
      staffNotification: true,
    });
    expect(queue.enqueued.map((j) => j.opts.maxAttempts)).toEqual([16, 16]);
  });

  it("enqueues nothing when neither is asked for", async () => {
    const queue = new InMemoryJobQueue();
    const uow = await new FakeUnitOfWorkFactory().begin();
    await enqueueSubmissionEmails(queue, uow, {
      submissionId: "s1",
      submitterConfirmation: false,
      staffNotification: false,
    });
    expect(queue.enqueued).toEqual([]);
  });
});
