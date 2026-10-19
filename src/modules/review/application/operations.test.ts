import { describe, expect, it } from "vitest";
import { reviewAuditActions } from "../domain/audit";
import {
  OPERATIONS_DEAD_LIMIT,
  discardJob,
  operationsView,
  retryAllOfType,
  retryJob,
  retryStoryJobs,
} from "./operations";
import { OWNER, seedAnotherStory, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

const reviewAudit = (deps: FakeReviewDeps) =>
  deps.audit.entries
    .filter((e) => (reviewAuditActions as readonly string[]).includes(e.entry.action))
    .map((e) => e.entry);

const statusOf = (deps: FakeReviewDeps, id: string) =>
  deps.jobs.jobs.find((j) => j.id === id)?.status;

describe("operationsView", () => {
  it("lists dead jobs with their stories and the heartbeat", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    deps.jobs.add({
      type: "media.upload",
      payload: { mediaId: story.photoIds[0] },
      lastError: "staging copy is missing",
      finishedAt: new Date("2026-10-18T11:00:00Z"),
    });
    deps.jobs.add({ type: "jobs.cleanup", payload: {} });
    deps.jobs.heartbeatAge = 45;

    const view = await operationsView(deps);

    expect(view.heartbeatAgeSeconds).toBe(45);
    expect(view.heartbeat).toBe("ok");
    expect(view.dead).toEqual([
      {
        id: "dead-job-1",
        type: "media.upload",
        attempts: 8,
        lastError: "staging copy is missing",
        createdAt: new Date("2026-10-18T09:00:00Z"),
        finishedAt: new Date("2026-10-18T11:00:00Z"),
        story: { formId: story.formId, reference: "ST-0001" },
      },
      {
        id: "dead-job-2",
        type: "jobs.cleanup",
        attempts: 8,
        lastError: null,
        createdAt: new Date("2026-10-18T09:00:00Z"),
        finishedAt: new Date("2026-10-18T10:00:00Z"),
        story: null,
      },
    ]);

    deps.jobs.heartbeatAge = null;
    const stale = await operationsView(deps);
    expect(stale.heartbeatAgeSeconds).toBeNull();
    expect(stale.heartbeat).toBe("critical");
  });

  it("offers retry all only for types with more than one dead job", async () => {
    const deps = makeReviewDeps();
    deps.jobs.add({ type: "media.upload", payload: { mediaId: "gone-1" } });
    deps.jobs.add({ type: "media.upload", payload: { mediaId: "gone-2" } });
    deps.jobs.add({ type: "email.staff_notification", payload: { submissionId: "gone-3" } });

    const view = await operationsView(deps);

    expect(view.typesWithMany).toEqual([{ type: "media.upload", count: 2 }]);
    expect(view.dead.map((j) => j.story)).toEqual([null, null, null]);
  });

  it("offers retry all for a type with one listed job and more beyond the list", async () => {
    const deps = makeReviewDeps();
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 18, 0, minutes));
    for (let i = 0; i < OPERATIONS_DEAD_LIMIT - 1; i += 1)
      deps.jobs.add({ type: "media.upload", payload: {}, finishedAt: at(600 + i) });
    deps.jobs.add({ type: "email.staff_notification", payload: {}, finishedAt: at(500) });
    deps.jobs.add({ type: "email.staff_notification", payload: {}, finishedAt: at(100) });

    const view = await operationsView(deps);

    expect(view.dead).toHaveLength(OPERATIONS_DEAD_LIMIT);
    expect(view.dead.filter((j) => j.type === "email.staff_notification")).toHaveLength(1);
    expect(view.typesWithMany).toEqual([
      { type: "media.upload", count: OPERATIONS_DEAD_LIMIT - 1 },
      { type: "email.staff_notification", count: 2 },
    ]);
  });
});

describe("retryJob", () => {
  it("retries one job and records it", async () => {
    const deps = makeReviewDeps();
    deps.jobs.add({ type: "media.upload", payload: { mediaId: "m1" } });

    expect(await retryJob(deps, OWNER, "dead-job-1")).toBe(true);

    expect(statusOf(deps, "dead-job-1")).toBe("pending");
    expect(reviewAudit(deps)).toEqual([
      {
        action: "job_retried",
        actorEmail: OWNER.email,
        targetId: "dead-job-1",
        ip: OWNER.ip,
        details: { type: "media.upload" },
      },
    ]);

    // Now pending, so not dead any more.
    expect(await retryJob(deps, OWNER, "dead-job-1")).toBe(false);
    expect(reviewAudit(deps)).toHaveLength(1);
  });
});

describe("discardJob", () => {
  it("discards with a reason of 1 to 200 characters", async () => {
    const deps = makeReviewDeps();
    deps.jobs.add({ type: "media.upload", payload: { mediaId: "m1" } });

    expect(await discardJob(deps, OWNER, { jobId: "dead-job-1", reason: "   " })).toEqual({
      ok: false,
      code: "reason_invalid",
    });
    expect(await discardJob(deps, OWNER, { jobId: "dead-job-1", reason: "x".repeat(201) })).toEqual(
      { ok: false, code: "reason_invalid" },
    );
    expect(statusOf(deps, "dead-job-1")).toBe("dead");
    expect(reviewAudit(deps)).toEqual([]);

    expect(
      await discardJob(deps, OWNER, {
        jobId: "dead-job-1",
        reason: "Dropbox file removed by hand",
      }),
    ).toEqual({ ok: true });

    const job = deps.jobs.jobs.find((j) => j.id === "dead-job-1");
    expect(job?.status).toBe("discarded");
    expect(job?.discardReason).toBe("Dropbox file removed by hand");
    expect(reviewAudit(deps)).toEqual([
      {
        action: "job_discarded",
        actorEmail: OWNER.email,
        targetId: "dead-job-1",
        ip: OWNER.ip,
        details: { type: "media.upload" },
      },
    ]);
    expect(await discardJob(deps, OWNER, { jobId: "dead-job-1", reason: "Again" })).toEqual({
      ok: false,
      code: "not_found",
    });
  });
});

describe("retryAllOfType", () => {
  it("retries all of a type with one audit entry", async () => {
    const deps = makeReviewDeps();
    deps.jobs.add({ type: "media.upload", payload: { mediaId: "m1" } });
    deps.jobs.add({ type: "media.upload", payload: { mediaId: "m2" } });
    deps.jobs.add({ type: "email.staff_notification", payload: { submissionId: "s1" } });

    expect(await retryAllOfType(deps, OWNER, "media.upload")).toBe(2);

    expect(deps.jobs.jobs.map((j) => j.status)).toEqual(["pending", "pending", "dead"]);
    expect(reviewAudit(deps)).toEqual([
      {
        action: "jobs_retried_bulk",
        actorEmail: OWNER.email,
        targetId: null,
        ip: OWNER.ip,
        details: { type: "media.upload", count: 2 },
      },
    ]);

    expect(await retryAllOfType(deps, OWNER, "media.upload")).toBe(0);
    expect(reviewAudit(deps)).toHaveLength(1);
  });
});

describe("retryStoryJobs", () => {
  it("retries a story's dead jobs", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const other = await seedAnotherStory(deps, story.formId);
    deps.jobs.add({ type: "media.upload", payload: { mediaId: story.photoIds[1] } });
    deps.jobs.add({
      type: "email.staff_notification",
      payload: { submissionId: story.submissionId },
    });
    deps.jobs.add({
      type: "email.staff_notification",
      payload: { submissionId: other.submissionId },
    });

    expect(await retryStoryJobs(deps, OWNER, { formId: story.formId, reference: "ST-0001" })).toBe(
      2,
    );

    expect(deps.jobs.jobs.map((j) => j.status)).toEqual(["pending", "pending", "dead"]);
    const retried = reviewAudit(deps);
    expect(retried.map((e) => e.action)).toEqual(["job_retried", "job_retried"]);
    expect(retried.map((e) => e.targetId).sort()).toEqual(["dead-job-1", "dead-job-2"]);

    expect(
      await retryStoryJobs(deps, OWNER, { formId: story.formId, reference: "ST-0999" }),
    ).toBeNull();
    expect(reviewAudit(deps)).toHaveLength(2);
  });
});
