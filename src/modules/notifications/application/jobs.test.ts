import { describe, expect, it } from "vitest";
import { handlerContext } from "@/shared/application/testing/fakes";
import { EmailSendError } from "./ports/email-sender";
import {
  createJobAlertHandler,
  createStaffNotificationHandler,
  createSubmitterConfirmationHandler,
} from "./jobs";
import { makeNotificationsDeps } from "./testing/fakes";

const SUB = "00000005-0000-4000-8000-000000000005";
const confirmation = {
  to: "family@example.com",
  data: {
    locale: "es" as const,
    formTitle: "Historias",
    subject: "Gracias",
    body: "Recibimos **todo**.",
    receivedOn: "10 de octubre de 2026",
    reference: "HP-0001",
    retentionMonths: 12,
    contact: "privacy@example.com",
  },
};

describe("email.submitter_confirmation", () => {
  it("renders, sends once to the submitter and records the provider id", async () => {
    const deps = makeNotificationsDeps();
    deps.source.confirmation = confirmation;
    const handler = createSubmitterConfirmationHandler(deps);
    await handler({ submissionId: SUB }, handlerContext());
    await handler({ submissionId: SUB }, handlerContext());
    expect(deps.sender.sent).toHaveLength(1);
    expect(deps.sender.sent[0]).toMatchObject({ to: ["family@example.com"], subject: "Gracias" });
    expect(deps.deliveries.entries.get(`email.submitter_confirmation:${SUB}`)).toBe("msg-1");
  });

  it("logs the submission id and never the address", async () => {
    const deps = makeNotificationsDeps();
    deps.source.confirmation = confirmation;
    const ctx = handlerContext();
    await createSubmitterConfirmationHandler(deps)({ submissionId: SUB }, ctx);
    const lines = JSON.stringify((ctx.logger as unknown as { lines: unknown[] }).lines);
    expect(lines).toContain(SUB);
    expect(lines).not.toContain("@");
  });

  it("ends without sending when the submission is gone or has no address", async () => {
    const deps = makeNotificationsDeps();
    await createSubmitterConfirmationHandler(deps)({ submissionId: SUB }, handlerContext());
    expect(deps.sender.sent).toEqual([]);
    expect(deps.deliveries.entries.size).toBe(0);
  });

  it("fails permanently on a permanent provider error and retries otherwise", async () => {
    const deps = makeNotificationsDeps();
    deps.source.confirmation = confirmation;
    const handler = createSubmitterConfirmationHandler(deps);
    deps.sender.failWith = new EmailSendError("smtp2go rejected the recipient", true);
    await expect(handler({ submissionId: SUB }, handlerContext())).rejects.toMatchObject({
      name: "PermanentJobError",
    });
    deps.sender.failWith = new EmailSendError("smtp2go failed with 503", false);
    await expect(handler({ submissionId: SUB }, handlerContext())).rejects.toMatchObject({
      name: "EmailSendError",
    });
    expect(deps.deliveries.entries.size).toBe(0);
  });

  it("fails permanently when the payload has no submission id", async () => {
    const deps = makeNotificationsDeps();
    await expect(
      createSubmitterConfirmationHandler(deps)({ submissionId: 7 }, handlerContext()),
    ).rejects.toMatchObject({ name: "PermanentJobError" });
  });
});

describe("email.staff_notification", () => {
  it("sends one message to every recipient", async () => {
    const deps = makeNotificationsDeps();
    deps.source.staff = {
      to: ["stories@example.com", "team@example.com"],
      data: {
        formTitle: "Stories",
        reference: "HP-0001",
        receivedAt: "2026-10-10 09:00 America/Panama, 14:00 UTC",
        link: "https://forms.example.com/admin/forms/f1",
      },
    };
    const handler = createStaffNotificationHandler(deps);
    await handler({ submissionId: SUB }, handlerContext());
    await handler({ submissionId: SUB }, handlerContext());
    expect(deps.sender.sent.map((m) => m.to)).toEqual([
      ["stories@example.com", "team@example.com"],
    ]);
    expect(deps.deliveries.entries.has(`email.staff_notification:${SUB}`)).toBe(true);
  });

  it("ends without sending when there is no recipient", async () => {
    const deps = makeNotificationsDeps();
    deps.source.staff = {
      to: [],
      data: { formTitle: "Stories", reference: "HP-0001", receivedAt: "now", link: "https://x" },
    };
    await createStaffNotificationHandler(deps)({ submissionId: SUB }, handlerContext());
    expect(deps.sender.sent).toEqual([]);
  });
});

describe("email.job_alert", () => {
  const alert = {
    to: ["alerts@example.com"],
    data: {
      jobType: "media.upload",
      count: 3,
      references: ["HP-0001"],
      moreCount: 0,
      link: "https://forms.example.com/admin/operations",
    },
  };

  it("sends one alert per alert job and records it under the job id", async () => {
    const deps = makeNotificationsDeps();
    deps.alerts.next = alert;
    const handler = createJobAlertHandler(deps);
    await handler({ jobType: "media.upload" }, handlerContext({ jobId: "job-9" }));
    await handler({ jobType: "media.upload" }, handlerContext({ jobId: "job-9" }));
    expect(deps.sender.sent).toHaveLength(1);
    expect(deps.sender.sent[0]).toMatchObject({ to: ["alerts@example.com"] });
    expect(deps.deliveries.entries.get("email.job_alert:job-9")).toBe("msg-1");
  });

  it("sends nothing when the source has nothing", async () => {
    const deps = makeNotificationsDeps();
    deps.alerts.next = null;
    await createJobAlertHandler(deps)({ jobType: "media.upload" }, handlerContext());
    expect(deps.sender.sent).toEqual([]);
    expect(deps.deliveries.entries.size).toBe(0);
  });

  it("succeeds without sending when no dead job of its type remains", async () => {
    const deps = makeNotificationsDeps();
    deps.alerts.next = alert;
    const handler = createJobAlertHandler(deps);
    await handler({ jobType: "media.upload" }, handlerContext({ jobId: "job-1" }));
    // The jobs were retried or discarded meanwhile: the next alert job finds nothing.
    deps.alerts.next = null;
    await expect(
      handler({ jobType: "media.upload" }, handlerContext({ jobId: "job-2" })),
    ).resolves.toBeUndefined();
    expect(deps.sender.sent).toHaveLength(1);
    expect(deps.deliveries.entries.has("email.job_alert:job-2")).toBe(false);
  });

  it("fails permanently without a job type", async () => {
    const deps = makeNotificationsDeps();
    deps.alerts.next = alert;
    await expect(createJobAlertHandler(deps)({}, handlerContext())).rejects.toMatchObject({
      name: "PermanentJobError",
    });
    expect(deps.sender.sent).toEqual([]);
  });
});
