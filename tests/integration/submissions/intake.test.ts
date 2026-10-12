import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyLifecycle } from "@/modules/definitions/application";
import {
  expireInProgress,
  postContext,
  savePage,
  submitForm,
  uploadFile,
  type PagePost,
  type PostOutcome,
  type SubmissionRepository,
  type SubmissionsDeps,
} from "@/modules/submissions/application";
import { CONSENT_TEXT, storyVersion } from "@/modules/submissions/domain/testing/versions";
import type { EnqueueOptions, JobPayload, JobQueue } from "@/shared/application/ports/job-queue";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { RecordingLogger } from "@/shared/application/testing/fakes";
import { consentTextVersion } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import {
  brokenMp4,
  htmlPretendingToBeJpeg,
  syntheticJpegWithGps,
  syntheticPng,
} from "../../fakes/media-files";
import { testPool, truncateAll, waitForLockWaiters } from "../db";
import { seedPublishedForm as seedForm } from "./factories";
import { pgSubmissionsDeps } from "./wiring";

const consent = { accepted: true, textVersion: consentTextVersion(CONSENT_TEXT) };

/** The story form with one staff recipient, so a submission enqueues both emails. */
const seedPublishedForm = (pool: Parameters<typeof seedForm>[0]) =>
  seedForm(pool, storyVersion(), { notificationRecipients: ["stories@example.com"] });

/** A `JobQueue` whose `failAt`-th enqueue (0-based) rejects. */
class FailingQueue implements JobQueue {
  private calls = 0;

  constructor(
    private readonly inner: JobQueue,
    private readonly failAt: number,
  ) {}

  enqueue(
    uow: UnitOfWork,
    type: string,
    payload: JobPayload,
    opts?: EnqueueOptions,
  ): Promise<string | null> {
    const n = this.calls;
    this.calls += 1;
    if (n === this.failAt) return Promise.reject(new Error("injected enqueue failure"));
    return this.inner.enqueue(uow, type, payload, opts);
  }
}

describe("the intake against Postgres", () => {
  const pool = testPool();
  let dir: string;
  let slug: string;
  let formId: string;
  let versionId: string;

  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-intake-"));
    ({ slug, formId, versionId } = await seedPublishedForm(pool));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const dirs = () => ({ staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });

  async function count(table: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`);
    return rows[0]?.n ?? 0;
  }

  /** Files (names with a dot) under `<dir>/staging`; none when the directory was never made. */
  async function stagedFiles(root = path.join(dir, "staging")): Promise<string[]> {
    try {
      const entries = await readdir(root, { recursive: true });
      return entries.map(String).filter((f) => path.basename(f).includes("."));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async function contextOf(deps: SubmissionsDeps, id: string) {
    const ctx = await postContext(deps, {
      slug,
      state: { kind: "record", id },
      submitToken: null,
    });
    if (!ctx.ok) throw new Error(ctx.outcome.kind);
    return ctx;
  }

  const basePost = (over: Partial<PagePost>): PagePost => ({
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
  });

  const emptyPost = (id: string): PagePost =>
    basePost({ pageKey: "page_consent", state: { kind: "record", id } });

  async function reachPhotos(deps: SubmissionsDeps): Promise<string> {
    const ctx = await postContext(deps, { slug, state: { kind: "none" }, submitToken: null });
    if (!ctx.ok) throw new Error(ctx.outcome.kind);
    const out = await savePage(
      deps,
      ctx,
      basePost({
        answers: { f_name: "Ana Prueba", f_email: "family@example.com", f_baby: "yes_opt" },
        renderedAt: new Date(Date.now() - 60_000),
      }),
    );
    if (out.kind !== "show") throw new Error(out.kind);
    return out.recordId;
  }

  async function reachConsent(deps: SubmissionsDeps): Promise<string> {
    const id = await reachPhotos(deps);
    for (const bytes of [await syntheticJpegWithGps(), await syntheticPng()]) {
      const up = await uploadFile(deps, await contextOf(deps, id), {
        fieldKey: "f_photos",
        bytes,
        renderedAt: null,
        acceptLanguage: "es",
      });
      if (!up.ok) throw new Error(up.code);
    }
    const next = await savePage(
      deps,
      await contextOf(deps, id),
      basePost({ pageKey: "page_baby", state: { kind: "record", id } }),
    );
    if (next.kind !== "show") throw new Error(next.kind);
    return id;
  }

  async function submit(
    deps: SubmissionsDeps,
    id: string,
    over: Partial<PagePost> = {},
  ): Promise<PostOutcome> {
    const { rows } = await pool.query<{ t: string }>(
      "select submit_token as t from submission_in_progress where id = $1",
      [id],
    );
    const token = rows[0]?.t ?? null;
    const ctx = await postContext(deps, {
      slug,
      state: { kind: "record", id },
      submitToken: token,
    });
    if (!ctx.ok) return ctx.outcome;
    return submitForm(
      deps,
      ctx,
      basePost({
        pageKey: "page_consent",
        action: { kind: "submit" },
        answers: { f_consent: consent },
        submitToken: token,
        state: { kind: "record", id },
        ...over,
      }),
    );
  }

  async function formRow() {
    const { rows } = await pool.query<{ next_reference: number; updated_at: Date }>(
      "select next_reference, updated_at from form where id = $1",
      [formId],
    );
    return rows[0];
  }

  async function tokenOf(id: string): Promise<string> {
    const { rows } = await pool.query<{ t: string }>(
      "select submit_token as t from submission_in_progress where id = $1",
      [id],
    );
    return rows[0]?.t ?? "";
  }

  /** A submission already stored under `token`, as a first Submit would have left it. */
  async function storedUnder(deps: SubmissionsDeps, token: string): Promise<void> {
    await deps.uow.run((u) =>
      deps.submissions.insert(u, {
        id: randomUUID(),
        formId,
        versionId,
        locale: "es",
        answers: {},
        consent: null,
        receivedAt: new Date(),
        reference: "SF-0009",
        submitToken: token,
      }),
    );
  }

  it("stores everything in one transaction", async () => {
    const deps = pgSubmissionsDeps(pool, dirs());
    const id = await reachConsent(deps);
    const out = await submit(deps, id);
    expect(out.kind).toBe("submitted");
    expect([
      await count("submission"),
      await count("media"),
      await count("submission_in_progress"),
    ]).toEqual([1, 2, 0]);
    const jobs = (
      await pool.query<{ type: string }>("select type from job order by type")
    ).rows.map((r) => r.type);
    expect(jobs).toEqual([
      "email.staff_notification",
      "email.submitter_confirmation",
      "media.upload",
      "media.upload",
    ]);
    expect(await stagedFiles()).toHaveLength(2);
    // Logs carry ids only: no address, no answer.
    const lines = (deps.logger as RecordingLogger).lines;
    expect(lines.some((l) => l.msg === "submission received")).toBe(true);
    expect(JSON.stringify(lines)).not.toMatch(/@|Ana/);
  });

  it("leaves no orphan media rows or jobs when the intake fails, and keeps the record and its files", async () => {
    for (const failAt of [0, 1, 2, 3]) {
      await truncateAll(pool);
      ({ slug, formId } = await seedPublishedForm(pool));
      const queue = new FailingQueue(new PgJobQueue(systemIdGenerator, systemClock), failAt);
      const staging = path.join(dir, `staging-${String(failAt)}`);
      const deps = pgSubmissionsDeps(
        pool,
        { staging, durable: path.join(dir, "durable") },
        { queue },
      );
      const id = await reachConsent(deps);
      await expect(submit(deps, id)).rejects.toThrow("injected enqueue failure");
      expect([await count("submission"), await count("media"), await count("job")]).toEqual([
        0, 0, 0,
      ]);
      expect(await count("submission_in_progress")).toBe(1);
      expect((await formRow())?.next_reference).toBe(1);
      expect(await stagedFiles(staging)).toHaveLength(2);
    }
  });

  it("refuses a submission when the form closes during the intake", async () => {
    const deps = pgSubmissionsDeps(pool, dirs());
    const id = await reachConsent(deps);
    const closer = await pool.connect();
    try {
      await closer.query("begin");
      await closer.query("select id from form where id = $1 for update", [formId]);
      const pending = submit(deps, id);
      // The intake passed every read and waits on the form row inside allocateReference.
      await waitForLockWaiters(pool);
      await closer.query("update form set status = 'closed' where id = $1", [formId]);
      await closer.query("commit");
      expect(await pending).toEqual({ kind: "gate", state: "closed" });
    } finally {
      closer.release();
    }
    expect([await count("submission"), await count("media"), await count("job")]).toEqual([
      0, 0, 0,
    ]);
    expect(await count("submission_in_progress")).toBe(1);
    expect((await formRow())?.next_reference).toBe(1);
  });

  it("answers two simultaneous Submits with one submission and one reference", async () => {
    const deps = pgSubmissionsDeps(pool, dirs());
    const id = await reachConsent(deps);
    const before = await formRow();
    const [a, b] = await Promise.all([submit(deps, id), submit(deps, id)]);
    expect(a).toEqual(b);
    expect(a.kind).toBe("submitted");
    expect(await count("submission")).toBe(1);
    expect(await count("job")).toBe(4);
    expect(await formRow()).toEqual({ next_reference: 2, updated_at: before?.updated_at });
  });

  it("commits nothing for a submit token that already has a submission", async () => {
    const deps = pgSubmissionsDeps(pool, dirs());
    const id = await reachConsent(deps);
    const token = await tokenOf(id);
    await storedUnder(deps, token);
    const before = await formRow();
    expect(await submit(deps, id)).toEqual({ kind: "submitted", submitToken: token });
    expect([await count("submission"), await count("media"), await count("job")]).toEqual([
      1, 0, 0,
    ]);
    expect(await formRow()).toEqual(before);
  });

  it("rolls the reference back when the insert meets a token the pre-check missed", async () => {
    const deps = pgSubmissionsDeps(pool, dirs());
    const id = await reachConsent(deps);
    const token = await tokenOf(id);
    await storedUnder(deps, token);
    const real = deps.submissions;
    // Every token lookup misses, as when a concurrent first Submit commits between check and insert.
    const blind: SubmissionRepository = {
      insert: (u, s) => real.insert(u, s),
      findById: (sid) => real.findById(sid),
      findBySubmitToken: () => Promise.resolve(null),
    };
    const before = await formRow();
    expect(await submit({ ...deps, submissions: blind }, id)).toEqual({
      kind: "submitted",
      submitToken: token,
    });
    expect([await count("submission"), await count("media"), await count("job")]).toEqual([
      1, 0, 0,
    ]);
    expect(await count("submission_in_progress")).toBe(1);
    expect(await formRow()).toEqual(before);
  });

  it("refuses a lying, truncated or oversized file and stages nothing", async () => {
    const deps = pgSubmissionsDeps(pool, dirs());
    const id = await reachPhotos(deps);
    const jpeg = await syntheticJpegWithGps();
    const tries = [
      [htmlPretendingToBeJpeg(), "file_wrong_type"],
      [jpeg.subarray(0, Math.floor(jpeg.length / 2)), "file_unreadable"],
      [brokenMp4(), "file_unreadable"],
      [new Uint8Array(11 * 1024 * 1024), "file_too_large"],
    ] as const;
    for (const [bytes, code] of tries) {
      const out = await uploadFile(deps, await contextOf(deps, id), {
        fieldKey: "f_photos",
        bytes,
        renderedAt: null,
        acceptLanguage: "es",
      });
      expect(out).toMatchObject({ ok: false, code });
    }
    expect(await stagedFiles()).toEqual([]);
  });

  it("deletes the record and its staged files for a filled honeypot on a Next post", async () => {
    const deps = pgSubmissionsDeps(pool, dirs());
    const id = await reachConsent(deps);
    expect(await stagedFiles()).toHaveLength(2);
    const out = await savePage(deps, await contextOf(deps, id), {
      ...emptyPost(id),
      honeypot: "https://spam.example",
    });
    expect(out.kind).toBe("decoy");
    expect([
      await count("submission"),
      await count("submission_in_progress"),
      await count("media"),
    ]).toEqual([0, 0, 0]);
    expect(await stagedFiles()).toEqual([]);
  });

  it("expireInProgress removes expired records and their staged files", async () => {
    const deps = pgSubmissionsDeps(pool, dirs());
    await reachConsent(deps);
    expect(await stagedFiles()).toHaveLength(2);
    const removed = await expireInProgress(deps, {
      now: new Date(Date.now() + 25 * 60 * 60 * 1000),
      logger: new RecordingLogger(),
    });
    expect(removed).toBe(1);
    expect(await count("submission_in_progress")).toBe(0);
    expect(await stagedFiles()).toEqual([]);
  });

  it("closes through the lifecycle use case and the open tab is refused", async () => {
    const deps = pgSubmissionsDeps(pool, dirs());
    const id = await reachConsent(deps);
    expect(
      (
        await applyLifecycle(
          deps.definitions,
          { email: "editor@example.com", ip: "203.0.113.7" },
          { formId, action: "close" },
        )
      ).ok,
    ).toBe(true);
    expect(await submit(deps, id)).toEqual({ kind: "gate", state: "closed" });
  });
});
