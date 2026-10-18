import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PgMediaRepository } from "@/modules/media/infrastructure/pg-media-repository";
import {
  EMAIL_JOB_MAX_ATTEMPTS,
  EMAIL_JOB_TYPES,
  type NotificationsDeps,
} from "@/modules/notifications/application";
import {
  RecordingEmailSender,
  StubMessageSource,
} from "@/modules/notifications/application/testing/fakes";
import { PgDeliveryLog } from "@/modules/notifications/infrastructure/pg-delivery-log";
import { ReviewAlertSource } from "@/modules/review/application/alert-source";
import { RecordingLogger } from "@/shared/application/testing/fakes";
import type { Clock } from "@/shared/application/ports/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgJobStore } from "@/shared/infrastructure/jobs/pg-job-store";
import { Worker } from "@/shared/infrastructure/jobs/worker";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { emailTemplates } from "@/shared/presentation/email";
import { workerHandlers } from "@/app/worker-handlers";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "../submissions/factories";
import { seedStoredStory } from "./factories";
import { pgReviewDeps } from "./wiring";

const NOW = new Date("2026-10-18T15:00:00.000Z");

async function jobOf(pool: Pool, type: string) {
  const { rows } = await pool.query<{ status: string }>("select status from job where type = $1", [
    type,
  ]);
  return rows.map((r) => r.status);
}

describe("dead-job alerts end to end", () => {
  const pool = testPool();
  let dir: string;
  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-alert-flow-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("a dead upload ends in one alert email to ALERT_EMAIL", async () => {
    const clock: Clock = { now: () => NOW };
    const uow = new PgUnitOfWorkFactory(pool);
    const queue = new PgJobQueue(systemIdGenerator, clock);
    const review = pgReviewDeps(
      pool,
      { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") },
      { queue },
    );
    const sender = new RecordingEmailSender();
    const notifications: NotificationsDeps = {
      sender,
      renderer: emailTemplates,
      source: new StubMessageSource(),
      alerts: new ReviewAlertSource(review, {
        to: "alerts@example.com",
        publicBaseUrl: "https://forms.example.com",
      }),
      deliveries: new PgDeliveryLog(pool),
    };
    const store = new PgJobStore(pool, clock, {
      leaseSeconds: 60,
      deadAlert: { type: EMAIL_JOB_TYPES.jobAlert, maxAttempts: EMAIL_JOB_MAX_ATTEMPTS },
    });

    // A story whose photo's staging copy is gone: the upload fails for good.
    const { formId, slug } = await seedPublishedForm(pool, undefined, { usePostPlan: true });
    const mediaId = randomUUID();
    const story = await seedStoredStory(pool, {
      formId,
      reference: "ST-0042",
      answers: { f_name: "Ana Prueba", f_photos: [mediaId] },
    });
    await uow.run(async (u) => {
      await new PgMediaRepository(pool).insert(u, {
        id: mediaId,
        submissionId: story.submissionId,
        formId,
        fieldKey: "f_photos",
        position: 1,
        kind: "image",
        status: "staged",
        contentType: "image/jpeg",
        size: 64,
        stagingRef: `in-progress/${randomUUID()}/${mediaId}.jpg`,
        durableKey: `forms/${slug}/ST-0042/01-photos.jpg`,
        providerRef: null,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await queue.enqueue(u, "media.upload", { mediaId }, { maxAttempts: 1 });
    });

    const worker = new Worker(
      { store, queue, uow, clock, logger: new RecordingLogger() },
      {
        workerId: "alert-flow-worker",
        concurrency: 4,
        pollIntervalMs: 10,
        jobTimeoutMs: 5_000,
        handlers: workerHandlers({
          store,
          pool,
          media: review.media,
          notifications,
          submissions: review.submissions,
        }),
        recurring: [],
      },
    );
    await worker.tick();
    await worker.tick();

    expect(await jobOf(pool, "media.upload")).toEqual(["dead"]);
    expect(await jobOf(pool, EMAIL_JOB_TYPES.jobAlert)).toEqual(["succeeded"]);
    expect(sender.sent).toHaveLength(1);
    const email = sender.sent[0];
    expect(email?.to).toEqual(["alerts@example.com"]);
    expect(email?.subject).toBe("Jobs need attention: media.upload (1)");
    expect(email?.text).toContain("ST-0042");
    expect(email?.text).toContain("https://forms.example.com/admin/operations");
    expect(email?.text).not.toContain("Ana Prueba");
    expect(email?.html).not.toContain("Ana Prueba");
  });
});
