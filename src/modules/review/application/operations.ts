import type { Actor } from "@/modules/definitions/application";
import { findMedia, listSubmissionMedia } from "@/modules/media/application";
import { findSubmission, findSubmissionByReference } from "@/modules/submissions/application";
import { HEARTBEAT_STALE_SECONDS } from "@/shared/application/health";
import type { DeadJob } from "@/shared/application/ports/job-admin";
import type { JobPayload } from "@/shared/application/ports/job-queue";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { heartbeatState, type HeartbeatState } from "../domain/heartbeat";
import type { ReviewDeps } from "./deps";

/** Operations lists at most this many dead jobs, the most recently dead first. */
export const OPERATIONS_DEAD_LIMIT = 200;

/** A discard reason is 1 to this many characters once trimmed. */
export const DISCARD_REASON_MAX = 200;

/** A dead job as Operations shows it: identifiers and the scrubbed error, never the payload. */
export interface DeadJobRow {
  id: string;
  type: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  story: { formId: string; reference: string } | null;
}

export interface OperationsView {
  heartbeatAgeSeconds: number | null;
  heartbeat: HeartbeatState;
  dead: DeadJobRow[];
  /** Types with more than one dead job, which offer "Retry all". */
  typesWithMany: { type: string; count: number }[];
}

type StoryRef = { formId: string; reference: string };

/** The story a dead job's payload points at, through `submissionId` or `mediaId`; null when gone. */
export async function storyOfJob(deps: ReviewDeps, payload: JobPayload): Promise<StoryRef | null> {
  let submissionId: string | null = null;
  const direct = payload["submissionId"];
  const mediaId = payload["mediaId"];
  if (typeof direct === "string") submissionId = direct;
  else if (typeof mediaId === "string")
    submissionId = (await findMedia(deps.media, mediaId))?.submissionId ?? null;
  if (submissionId === null) return null;
  const submission = await findSubmission(deps.submissions, submissionId);
  return submission ? { formId: submission.formId, reference: submission.reference } : null;
}

/** `storyOfJob` with one lookup per distinct payload target. */
export function storyResolver(deps: ReviewDeps): (job: DeadJob) => Promise<StoryRef | null> {
  const seen = new Map<string, Promise<StoryRef | null>>();
  return (job) => {
    const { submissionId, mediaId } = job.payload;
    const key =
      typeof submissionId === "string"
        ? `s:${submissionId}`
        : typeof mediaId === "string"
          ? `m:${mediaId}`
          : null;
    if (key === null) return Promise.resolve(null);
    let found = seen.get(key);
    if (!found) {
      found = storyOfJob(deps, job.payload);
      seen.set(key, found);
    }
    return found;
  };
}

/** The Operations page (specs/use-cases/operate-jobs.md, "Main flow"). */
export async function operationsView(deps: ReviewDeps): Promise<OperationsView> {
  const [age, dead] = await Promise.all([
    deps.jobs.heartbeatAgeSeconds(deps.clock.now()),
    deps.jobs.listDead(OPERATIONS_DEAD_LIMIT),
  ]);
  const resolve = storyResolver(deps);
  const rows = await Promise.all(
    dead.map(async (job): Promise<DeadJobRow> => ({
      id: job.id,
      type: job.type,
      attempts: job.attempts,
      lastError: job.lastError,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      story: await resolve(job),
    })),
  );

  // "Retry all" counts every dead job of a listed type, not only the listed ones, so a type
  // with one job in the list and more beyond it still offers it.
  const listed = [...new Set(dead.map((job) => job.type))];
  const counted = await Promise.all(
    listed.map(async (type) => ({ type, count: (await deps.jobs.deadOfType(type, 0)).count })),
  );
  const typesWithMany = counted.filter((t) => t.count > 1);
  typesWithMany.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  return {
    heartbeatAgeSeconds: age,
    heartbeat: heartbeatState(age, HEARTBEAT_STALE_SECONDS),
    dead: rows,
    typesWithMany,
  };
}

async function recordRetried(
  deps: ReviewDeps,
  uow: UnitOfWork,
  actor: Actor,
  jobId: string,
  type: string,
  now: Date,
): Promise<void> {
  await deps.audit.record(
    uow,
    {
      action: "job_retried",
      actorEmail: actor.email,
      targetId: jobId,
      ip: actor.ip,
      details: { type },
    },
    now,
  );
}

/** Retries one dead job; false when it is not dead (any more). */
export async function retryJob(deps: ReviewDeps, actor: Actor, jobId: string): Promise<boolean> {
  return deps.uow.run(async (uow) => {
    const now = deps.clock.now();
    const type = await deps.jobs.retry(uow, jobId, now);
    if (type === null) return false;
    await recordRetried(deps, uow, actor, jobId, type, now);
    return true;
  });
}

/** Discards one dead job with a reason of 1 to 200 characters, kept on the job row only. */
export async function discardJob(
  deps: ReviewDeps,
  actor: Actor,
  input: { jobId: string; reason: string },
): Promise<{ ok: true } | { ok: false; code: "not_found" | "reason_invalid" }> {
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > DISCARD_REASON_MAX)
    return { ok: false, code: "reason_invalid" };
  return deps.uow.run(async (uow) => {
    const now = deps.clock.now();
    const type = await deps.jobs.discard(uow, input.jobId, reason, now);
    if (type === null) return { ok: false, code: "not_found" } as const;
    await deps.audit.record(
      uow,
      {
        action: "job_discarded",
        actorEmail: actor.email,
        targetId: input.jobId,
        ip: actor.ip,
        details: { type },
      },
      now,
    );
    return { ok: true } as const;
  });
}

/** Retries every dead job of the type with one `jobs_retried_bulk` entry; the number retried. */
export async function retryAllOfType(
  deps: ReviewDeps,
  actor: Actor,
  type: string,
): Promise<number> {
  return deps.uow.run(async (uow) => {
    const now = deps.clock.now();
    const ids = await deps.jobs.retryAllOfType(uow, type, now);
    if (ids.length === 0) return 0;
    await deps.audit.record(
      uow,
      {
        action: "jobs_retried_bulk",
        actorEmail: actor.email,
        targetId: null,
        ip: actor.ip,
        details: { type, count: ids.length },
      },
      now,
    );
    return ids.length;
  });
}

/** Retries every dead job of the story; null when the story is not there. */
export async function retryStoryJobs(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string },
): Promise<number | null> {
  const submission = await findSubmissionByReference(
    deps.submissions,
    input.formId,
    input.reference,
  );
  if (submission?.formId !== input.formId) return null;
  const media = await listSubmissionMedia(deps.media, submission.id);
  const dead = await deps.jobs.deadFor({
    submissionId: submission.id,
    mediaIds: media.map((m) => m.id),
  });
  if (dead.length === 0) return 0;
  return deps.uow.run(async (uow) => {
    const now = deps.clock.now();
    let retried = 0;
    for (const job of dead) {
      const type = await deps.jobs.retry(uow, job.id, now);
      if (type === null) continue;
      await recordRetried(deps, uow, actor, job.id, type, now);
      retried += 1;
    }
    return retried;
  });
}
