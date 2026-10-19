import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import type { ExportSource, ListFilter } from "@/modules/review/application/ports/review-queries";
import { readiness, type StoryChecks } from "@/modules/review/domain/readiness";
import { PgReviewQueries } from "@/modules/review/infrastructure/pg-review-queries";
import { storyVersion } from "@/modules/submissions/domain/testing/versions";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { sampleVersion } from "../definitions/factories";
import { testPool, truncateAll } from "../db";
import { seedStoredStory } from "./factories";

const NOW = new Date("2026-10-18T15:00:00.000Z");

describe("PgReviewQueries", () => {
  const pool = testPool();
  const queries = new PgReviewQueries(pool);
  beforeEach(() => truncateAll(pool));

  const filterOf = (formId: string, over: Partial<ListFilter> = {}): ListFilter => ({
    formId,
    status: null,
    plan: null,
    from: null,
    to: null,
    versionId: null,
    media: false,
    search: null,
    ...over,
  });

  /** `n` minutes before NOW. */
  const minutesAgo = (n: number): Date => new Date(NOW.getTime() - n * 60_000);

  async function insertMedia(
    submissionId: string,
    formId: string,
    fieldKey: string,
    position: number,
    over: { durableKey?: string; createdAt?: Date } = {},
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `insert into media (id, submission_id, form_id, field_key, position, kind, status,
         content_type, size, durable_key, created_at)
       values ($1, $2, $3, $4, $5, 'image', 'stored', 'image/jpeg', 1000, $6, $7)`,
      [
        id,
        submissionId,
        formId,
        fieldKey,
        position,
        over.durableKey ?? `/forms/test/${id}.jpg`,
        over.createdAt ?? NOW,
      ],
    );
    return id;
  }

  /** The live `staff_photo` row of a staff media row (same id). */
  async function insertStaffPhoto(mediaId: string, submissionId: string): Promise<void> {
    await pool.query(
      `insert into staff_photo (id, submission_id, source, sender_confirmed, added_by)
       values ($1, $2, 'whatsapp', true, 'owner@example.com')`,
      [mediaId, submissionId],
    );
  }

  async function insertJob(
    type: string,
    status: string,
    payload: Record<string, string>,
  ): Promise<void> {
    await pool.query("insert into job (id, type, payload, status) values ($1, $2, $3::jsonb, $4)", [
      randomUUID(),
      type,
      JSON.stringify(payload),
      status,
    ]);
  }

  async function insertStory(
    submissionId: string,
    formId: string,
    over: {
      plannedOn?: string | null;
      publishedOn?: string | null;
      chosen?: string[];
      photosEditedFor?: string[] | null;
      textCheckedAt?: Date | null;
    } = {},
  ): Promise<void> {
    await pool.query(
      `insert into story (submission_id, form_id, planned_on, published_on, chosen_media,
         photos_edited_for, text_checked_at)
       values ($1, $2, $3::date, $4::date, $5::uuid[], $6::uuid[], $7)`,
      [
        submissionId,
        formId,
        over.plannedOn ?? null,
        over.publishedOn ?? null,
        over.chosen ?? [],
        over.photosEditedFor ?? null,
        over.textCheckedAt ?? null,
      ],
    );
  }

  /** `count` stories of one form, the first the oldest, one minute apart. */
  async function seedMany(count: number): Promise<{ formId: string; references: string[] }> {
    const first = await seedStoredStory(pool, { receivedAt: minutesAgo(count) });
    const references = [first.reference];
    for (let i = 1; i < count; i += 1) {
      const next = await seedStoredStory(pool, {
        formId: first.formId,
        receivedAt: minutesAgo(count - i),
      });
      references.push(next.reference);
    }
    return { formId: first.formId, references };
  }

  const refs = (rows: readonly { reference: string }[]): string[] => rows.map((r) => r.reference);

  it("lists newest first, 50 a page, with the total", async () => {
    const { formId, references } = await seedMany(55);
    const newestFirst = [...references].reverse();
    const page1 = await queries.list(filterOf(formId), 1);
    const page2 = await queries.list(filterOf(formId), 2);
    expect(refs(page1.rows)).toEqual(newestFirst.slice(0, 50));
    expect(refs(page2.rows)).toEqual(newestFirst.slice(50));
    expect(page1.total).toBe(55);
    expect(page2.total).toBe(55);
  });

  it("filters by status, received days, version and files", async () => {
    const a = await seedStoredStory(pool, { receivedAt: new Date("2026-10-12T04:59:00.000Z") });
    const { formId } = a;
    const b = await seedStoredStory(pool, {
      formId,
      receivedAt: new Date("2026-10-12T05:00:00.000Z"),
      status: "viewed",
    });
    const c = await seedStoredStory(pool, {
      formId,
      receivedAt: new Date("2026-10-13T04:59:59.000Z"),
    });
    const second = { ...sampleVersion(formId, 2), document: storyVersion() };
    await new PgUnitOfWorkFactory(pool).run((uow) =>
      new PgVersionRepository(pool).insert(uow, second),
    );
    const d = await seedStoredStory(pool, {
      formId,
      receivedAt: new Date("2026-10-13T05:00:00.000Z"),
      versionId: second.id,
    });
    await insertMedia(a.submissionId, formId, "f_photos", 1);
    await insertMedia(c.submissionId, formId, "staff-photos", 1);
    const listed = async (over: Partial<ListFilter>): Promise<string[]> =>
      refs((await queries.list(filterOf(formId, over), 1)).rows).sort();

    expect(await listed({ status: "viewed" })).toEqual([b.reference]);
    expect(await listed({ from: "2026-10-12", to: "2026-10-12" })).toEqual(
      [b.reference, c.reference].sort(),
    );
    expect(await listed({ from: "2026-10-13" })).toEqual([d.reference]);
    expect(await listed({ to: "2026-10-11" })).toEqual([a.reference]);
    expect(await listed({ versionId: second.id })).toEqual([d.reference]);
    expect(await listed({ media: true })).toEqual([a.reference]);
  });

  it("searches the given keys and the reference only", async () => {
    const ana = await seedStoredStory(pool, {
      reference: "HP-0003",
      answers: { f_name: "Ana Prueba", f_story: "Ana" },
    });
    const { formId } = ana;
    const odd = await seedStoredStory(pool, {
      formId,
      reference: "HP-0004",
      answers: { f_name: "Cien% sin_azucar" },
    });
    const found = async (text: string, keys: string[]): Promise<string[]> =>
      refs((await queries.list(filterOf(formId, { search: { text, keys } }), 1)).rows);

    expect(await found("ana", ["f_name"])).toEqual([ana.reference]);
    expect(await found("ana", ["f_other"])).toEqual([]);
    expect(await found("HP-0003", [])).toEqual([ana.reference]);
    expect(await found("hp-0003", ["f_name"])).toEqual([ana.reference]);
    expect(await found("%", ["f_name"])).toEqual([odd.reference]);
    expect(await found("_", ["f_name"])).toEqual([odd.reference]);
    expect(await found("n% s", ["f_name"])).toEqual([odd.reference]);
    expect(await found("a%p", ["f_name"])).toEqual([]);
  });

  it("counts only the sender's files", async () => {
    const { formId, submissionId } = await seedStoredStory(pool);
    await insertMedia(submissionId, formId, "photos", 1);
    await insertMedia(submissionId, formId, "photos", 2);
    await insertMedia(submissionId, formId, "staff-photos", 1);
    const { rows } = await queries.list(filterOf(formId), 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mediaCount).toBe(2);
  });

  it("flags dead jobs of the story and of its media", async () => {
    const deadMedia = await seedStoredStory(pool, { receivedAt: minutesAgo(3) });
    const { formId } = deadMedia;
    const failedMedia = await seedStoredStory(pool, { formId, receivedAt: minutesAgo(2) });
    const deadEmail = await seedStoredStory(pool, { formId, receivedAt: minutesAgo(1) });
    const m1 = await insertMedia(deadMedia.submissionId, formId, "f_photos", 1);
    const m2 = await insertMedia(failedMedia.submissionId, formId, "f_photos", 1);
    await insertJob("media.upload", "dead", { mediaId: m1 });
    await insertJob("media.upload", "failed", { mediaId: m2 });
    await insertJob("email.staff_notification", "dead", { submissionId: deadEmail.submissionId });
    const { rows } = await queries.list(filterOf(formId), 1);
    const flag = Object.fromEntries(rows.map((r) => [r.reference, r.hasDeadJobs]));
    expect(flag).toEqual({
      [deadMedia.reference]: true,
      [failedMedia.reference]: false,
      [deadEmail.reference]: true,
    });
  });

  it("planned, waiting and not_ready", async () => {
    const planned = await seedStoredStory(pool, { receivedAt: minutesAgo(3) });
    const { formId } = planned;
    const published = await seedStoredStory(pool, { formId, receivedAt: minutesAgo(2) });
    const unplanned = await seedStoredStory(pool, { formId, receivedAt: minutesAgo(1) });
    await insertStory(planned.submissionId, formId, { plannedOn: "2026-10-20" });
    await insertStory(published.submissionId, formId, {
      plannedOn: "2026-10-19",
      publishedOn: "2026-10-19",
    });
    const listed = async (plan: ListFilter["plan"]): Promise<string[]> =>
      refs((await queries.list(filterOf(formId, { plan }), 1)).rows);

    expect(await listed("planned")).toEqual([planned.reference]);
    expect(await listed("waiting")).toEqual([unplanned.reference]);
    expect(await listed("not_ready")).toEqual([unplanned.reference, planned.reference]);
  });

  it("not_ready agrees with the domain readiness for every combination", async () => {
    const m = randomUUID();
    const m2 = randomUUID();
    const checked = new Date("2026-10-17T10:00:00.000Z");
    const cases: { name: string; checks: StoryChecks }[] = [];
    for (const chosen of [[], [m]])
      for (const photosEditedFor of [null, [m]])
        for (const textCheckedAt of [null, checked])
          cases.push({
            name: `chosen ${String(chosen.length)}, edited ${photosEditedFor === null ? "never" : "for [m]"}, text ${textCheckedAt === null ? "unchecked" : "checked"}`,
            checks: { chosen, photosEditedFor, textCheckedAt },
          });
    cases.push({
      name: "chosen [m], edited for [m2], text checked",
      checks: { chosen: [m], photosEditedFor: [m2], textCheckedAt: checked },
    });
    expect(cases).toHaveLength(9);

    const first = await seedStoredStory(pool);
    const { formId } = first;
    const byReference = new Map<string, string>();
    for (const [i, c] of cases.entries()) {
      const story =
        i === 0 ? first : await seedStoredStory(pool, { formId, receivedAt: minutesAgo(i) });
      await insertStory(story.submissionId, formId, {
        chosen: [...c.checks.chosen],
        photosEditedFor: c.checks.photosEditedFor === null ? null : [...c.checks.photosEditedFor],
        textCheckedAt: c.checks.textCheckedAt,
      });
      byReference.set(story.reference, c.name);
    }
    const notReady = (await queries.list(filterOf(formId, { plan: "not_ready" }), 1)).rows.map(
      (r) => byReference.get(r.reference),
    );
    const expected = cases.filter((c) => !readiness(c.checks).ready).map((c) => c.name);
    expect([...notReady].sort()).toEqual([...expected].sort());
    expect(cases.filter((c) => readiness(c.checks).ready).map((c) => c.name)).toEqual([
      "chosen 1, edited for [m], text checked",
    ]);
  });

  it("not_ready compares the chosen and edited photos as sets", async () => {
    const [a, b] = [randomUUID(), randomUUID()].sort();
    if (a === undefined || b === undefined) throw new Error("no ids");
    const checked = new Date("2026-10-17T10:00:00.000Z");
    const ready = await seedStoredStory(pool, { receivedAt: minutesAgo(2) });
    const { formId } = ready;
    const short = await seedStoredStory(pool, { formId, receivedAt: minutesAgo(1) });
    // Written out of order, as no use case writes them, to pin the comparison itself.
    await insertStory(ready.submissionId, formId, {
      chosen: [b, a],
      photosEditedFor: [a, b, a],
      textCheckedAt: checked,
    });
    await insertStory(short.submissionId, formId, {
      chosen: [b, a],
      photosEditedFor: [a],
      textCheckedAt: checked,
    });

    const notReady = await queries.list(filterOf(formId, { plan: "not_ready" }), 1);
    expect(refs(notReady.rows)).toEqual([short.reference]);
  });

  it("neighbours are found for a story outside the filter", async () => {
    const statuses = ["new", "new", "viewed", "new", "new"] as const;
    const first = await seedStoredStory(pool, { receivedAt: minutesAgo(5), status: statuses[0] });
    const { formId } = first;
    const stories = [first];
    for (let i = 1; i < statuses.length; i += 1)
      stories.push(
        await seedStoredStory(pool, {
          formId,
          receivedAt: minutesAgo(5 - i),
          status: statuses[i] ?? "new",
        }),
      );
    const at = (i: number): { receivedAt: Date; submissionId: string } => ({
      receivedAt: minutesAgo(5 - i),
      submissionId: stories[i]?.submissionId ?? "",
    });
    const filter = filterOf(formId, { status: "new" });

    expect(await queries.neighbours(filter, at(2))).toEqual({
      newer: stories[3]?.reference,
      older: stories[1]?.reference,
    });
    expect(await queries.neighbours(filter, at(4))).toEqual({
      newer: null,
      older: stories[3]?.reference,
    });
  });

  it("the week holds planned and published stories of the plan's forms only", async () => {
    const tuesday = await seedStoredStory(pool, { receivedAt: minutesAgo(4) });
    const { formId } = tuesday;
    const wednesday = await seedStoredStory(pool, {
      formId,
      receivedAt: minutesAgo(3),
      status: "published",
    });
    const nextWeek = await seedStoredStory(pool, { formId, receivedAt: minutesAgo(2) });
    const otherForm = await seedStoredStory(pool, { receivedAt: minutesAgo(1) });
    await pool.query("update submission set published_post_url = $2 where id = $1", [
      wednesday.submissionId,
      "https://www.instagram.com/p/TEST123/",
    ]);
    await insertStory(tuesday.submissionId, formId, { plannedOn: "2026-10-20" });
    await insertStory(wednesday.submissionId, formId, { publishedOn: "2026-10-21" });
    await insertStory(nextWeek.submissionId, formId, { plannedOn: "2026-10-27" });
    await insertStory(otherForm.submissionId, otherForm.formId, { plannedOn: "2026-10-22" });

    const week = await queries.week([formId], "2026-10-19", "2026-10-25");
    expect(refs(week)).toEqual([tuesday.reference, wednesday.reference]);
    expect(week[0]).toMatchObject({
      formId,
      plannedOn: "2026-10-20",
      publishedOn: null,
      status: "new",
      postUrl: null,
    });
    expect(week[1]).toMatchObject({
      plannedOn: null,
      publishedOn: "2026-10-21",
      status: "published",
      postUrl: "https://www.instagram.com/p/TEST123/",
    });
  });

  it("waiting lists unpublished, unplanned stories newest first with the total", async () => {
    const older = await seedStoredStory(pool, { receivedAt: minutesAgo(5) });
    const { formId } = older;
    const newer = await seedStoredStory(pool, { formId, receivedAt: minutesAgo(4) });
    const planned = await seedStoredStory(pool, { formId, receivedAt: minutesAgo(3) });
    const published = await seedStoredStory(pool, { formId, receivedAt: minutesAgo(2) });
    await seedStoredStory(pool, { receivedAt: minutesAgo(1) });
    await insertStory(newer.submissionId, formId, { chosen: [randomUUID()] });
    await insertStory(planned.submissionId, formId, { plannedOn: "2026-10-20" });
    await insertStory(published.submissionId, formId, { publishedOn: "2026-10-16" });

    const all = await queries.waiting([formId], 10);
    expect(refs(all.rows)).toEqual([newer.reference, older.reference]);
    expect(all.total).toBe(2);
    expect(all.rows[0]?.checks.chosen).toHaveLength(1);
    const one = await queries.waiting([formId], 1);
    expect(refs(one.rows)).toEqual([newer.reference]);
    expect(one.total).toBe(2);
  });

  it("export batches follow list order without gaps", async () => {
    const first = await seedStoredStory(pool, { receivedAt: minutesAgo(5) });
    const { formId } = first;
    const stories = [first];
    // Two pairs share a received time, so the id breaks the tie.
    for (const minutes of [5, 4, 3, 3, 2, 1])
      stories.push(await seedStoredStory(pool, { formId, receivedAt: minutesAgo(minutes) }));
    const withFiles = stories[0];
    if (withFiles === undefined) throw new Error("no story seeded");
    await insertMedia(withFiles.submissionId, formId, "f_photos", 2, { durableKey: "k/photos-2" });
    await insertMedia(withFiles.submissionId, formId, "f_docs", 1, { durableKey: "k/docs-1" });
    await insertMedia(withFiles.submissionId, formId, "f_photos", 1, { durableKey: "k/photos-1" });
    const later = await insertMedia(withFiles.submissionId, formId, "staff-photos", 1, {
      durableKey: "k/staff-later",
      createdAt: new Date("2026-10-18T12:00:00.000Z"),
    });
    const earlier = await insertMedia(withFiles.submissionId, formId, "staff-photos", 2, {
      durableKey: "k/staff-earlier",
      createdAt: new Date("2026-10-18T11:00:00.000Z"),
    });
    for (const id of [later, earlier]) await insertStaffPhoto(id, withFiles.submissionId);
    // Removed: its staff_photo row is gone, its media row awaits media.delete.
    await insertMedia(withFiles.submissionId, formId, "staff-photos", 3, {
      durableKey: "k/staff-removed",
      createdAt: new Date("2026-10-18T10:00:00.000Z"),
    });

    const filter = filterOf(formId);
    const batches: string[][] = [];
    const exported: ExportSource[] = [];
    let after: { receivedAt: Date; submissionId: string } | null = null;
    for (;;) {
      const batch = await queries.exportBatch(filter, after, 3);
      batches.push(refs(batch));
      if (batch.length === 0) break;
      exported.push(...batch);
      const last = batch[batch.length - 1];
      if (last === undefined) break;
      after = { receivedAt: last.receivedAt, submissionId: last.submissionId };
    }
    expect(batches.map((b) => b.length)).toEqual([3, 3, 1, 0]);
    expect(refs(exported)).toEqual(refs((await queries.list(filter, 1)).rows));
    const source = exported.find((e) => e.reference === withFiles.reference);
    expect(source?.senderFiles).toEqual([
      { fieldKey: "f_docs", key: "k/docs-1" },
      { fieldKey: "f_photos", key: "k/photos-1" },
      { fieldKey: "f_photos", key: "k/photos-2" },
    ]);
    expect(source?.staffKeys).toEqual(["k/staff-earlier", "k/staff-later"]);
    expect(exported.find((e) => e.reference !== withFiles.reference)).toMatchObject({
      senderFiles: [],
      staffKeys: [],
      curatedAnswers: {},
      postUrl: null,
      plannedOn: null,
    });
  });

  it("an export batch of a size that is not a positive whole number is empty", async () => {
    const { formId } = await seedStoredStory(pool);
    const filter = filterOf(formId);
    expect(await queries.exportBatch(filter, null, 1)).toHaveLength(1);
    for (const size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(await queries.exportBatch(filter, null, size)).toEqual([]);
  });

  it("a malformed form id or version id lists nothing", async () => {
    const { formId } = await seedStoredStory(pool);
    const malformed = filterOf("not-a-uuid");
    expect(await queries.list(malformed, 1)).toEqual({ rows: [], total: 0 });
    expect(await queries.count(malformed)).toBe(0);
    expect(await queries.statusCounts("not-a-uuid")).toEqual({
      new: 0,
      viewed: 0,
      edited: 0,
      published: 0,
    });
    expect(await queries.list(filterOf(formId, { versionId: "none" }), 1)).toEqual({
      rows: [],
      total: 0,
    });
    expect(await queries.statusCounts(formId)).toEqual({
      new: 1,
      viewed: 0,
      edited: 0,
      published: 0,
    });
  });
});
