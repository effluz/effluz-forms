/**
 * In-memory fakes for submissions use-case tests.
 *
 * - `InMemoryInProgressRepository`: `rows` by id, copies in and out; `insert`
 *   rejects an existing id and `update` a missing one, as the table would;
 *   `findForUpdate` is `find` (one process needs no locks).
 * - `InMemorySubmissionRepository`: `rows` by id; `insert` answers
 *   `duplicate_token` when any row has the submit token.
 * - `makeSubmissionsDeps()`: one clock, one id generator and one queue shared
 *   by definitions, media and submissions, plus the two repositories above.
 * - `publishStory(deps, settings?)`: the three-page story form, published as
 *   `story-form`.
 * - `post(over)`: a `PagePost` for page one, pressing Next, nothing answered.
 *
 * Synthetic data only. Not for production code.
 */
import {
  makeDefinitionsDeps,
  seedPublished,
  type FakeDefinitionsDeps,
} from "@/modules/definitions/application/testing/fakes";
import type { FormSettings } from "@/modules/definitions/application";
import { makeMediaDeps, type FakeMediaDeps } from "@/modules/media/application/testing/fakes";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import {
  FakeUnitOfWorkFactory,
  FixedClock,
  InMemoryJobQueue,
  RecordingLogger,
  SequentialIdGenerator,
} from "@/shared/application/testing/fakes";
import { buildDefaultRegistry } from "@/shared/domain/form-model";
import type { InProgress } from "../../domain/in-progress";
import { storyVersion } from "../../domain/testing/versions";
import type { Submission } from "../../domain/submission";
import type { SubmissionsDeps } from "../deps";
import type { PagePost } from "../fill-state";
import type { InProgressRepository } from "../ports/in-progress-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { VersionCache } from "../version-cache";

export class InMemoryInProgressRepository implements InProgressRepository {
  readonly rows = new Map<string, InProgress>();

  insert(_uow: UnitOfWork, record: InProgress): Promise<void> {
    if (this.rows.has(record.id)) return Promise.reject(new Error(`record ${record.id} exists`));
    this.rows.set(record.id, structuredClone(record));
    return Promise.resolve();
  }

  find(id: string): Promise<InProgress | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? structuredClone(row) : null);
  }

  findForUpdate(_uow: UnitOfWork, id: string): Promise<InProgress | null> {
    return this.find(id);
  }

  update(_uow: UnitOfWork, record: InProgress): Promise<void> {
    if (!this.rows.has(record.id))
      return Promise.reject(new Error(`record ${record.id} does not exist`));
    this.rows.set(record.id, structuredClone(record));
    return Promise.resolve();
  }

  delete(_uow: UnitOfWork, id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }

  listExpired(now: Date, limit: number): Promise<string[]> {
    const expired = [...this.rows.values()]
      .filter((row) => row.expiresAt.getTime() <= now.getTime())
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
    return Promise.resolve(expired.slice(0, limit).map((row) => row.id));
  }
}

export class InMemorySubmissionRepository implements SubmissionRepository {
  readonly rows = new Map<string, Submission>();

  insert(_uow: UnitOfWork, submission: Submission): Promise<"inserted" | "duplicate_token"> {
    for (const row of this.rows.values())
      if (row.submitToken === submission.submitToken) return Promise.resolve("duplicate_token");
    this.rows.set(submission.id, structuredClone(submission));
    return Promise.resolve("inserted");
  }

  findBySubmitToken(token: string): Promise<Submission | null> {
    for (const row of this.rows.values())
      if (row.submitToken === token) return Promise.resolve(structuredClone(row));
    return Promise.resolve(null);
  }

  findById(id: string): Promise<Submission | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? structuredClone(row) : null);
  }
}

export interface FakeSubmissionsDeps extends SubmissionsDeps {
  definitions: FakeDefinitionsDeps;
  media: FakeMediaDeps;
  inProgress: InMemoryInProgressRepository;
  submissions: InMemorySubmissionRepository;
  queue: InMemoryJobQueue;
  clock: FixedClock;
  logger: RecordingLogger;
}

/** One clock, one id generator and one queue across the three modules. */
export function makeSubmissionsDeps(): FakeSubmissionsDeps {
  const clock = new FixedClock();
  const ids = new SequentialIdGenerator();
  const queue = new InMemoryJobQueue();
  const uow = new FakeUnitOfWorkFactory();
  const registry = buildDefaultRegistry();
  return {
    definitions: makeDefinitionsDeps({ clock, ids, uow, registry }),
    media: makeMediaDeps({ clock, ids, queue, uow }),
    inProgress: new InMemoryInProgressRepository(),
    submissions: new InMemorySubmissionRepository(),
    queue,
    uow,
    clock,
    ids,
    registry,
    logger: new RecordingLogger(),
    versions: new VersionCache(),
    random: () => 0.5,
  };
}

/** Publishes `storyVersion()` as `story-form`, reference prefix `ST`, one staff recipient. */
export async function publishStory(
  deps: FakeSubmissionsDeps,
  settings: Partial<FormSettings> = {},
): Promise<{ formId: string; versionId: string; slug: "story-form" }> {
  const { formId, versionId } = await seedPublished(deps.definitions, {
    slug: "story-form",
    document: storyVersion(),
    settings: {
      referencePrefix: "ST",
      notificationRecipients: ["stories@example.com"],
      ...settings,
    },
  });
  return { formId, versionId, slug: "story-form" };
}

/** A post for the first page pressing Next, with nothing answered. */
export function post(over: Partial<PagePost> = {}): PagePost {
  return {
    pageKey: "page_contact",
    action: { kind: "next" },
    answers: {},
    decodeIssues: [],
    raw: {},
    incoming: [],
    renderedAt: null,
    honeypot: "",
    submitToken: null,
    acceptLanguage: "es",
    state: { kind: "none" },
    ...over,
  };
}
