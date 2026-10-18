import { describe, expect, it } from "vitest";
import type { JobAdmin } from "../ports/job-admin";
import {
  FakeUnitOfWorkFactory,
  InMemoryJobAdmin,
  InMemoryJobQueue,
  RecordingLogger,
} from "./fakes";

describe("InMemoryJobAdmin", () => {
  const NOW = new Date("2026-10-18T12:00:00Z");
  const at = (hhmm: string): Date => new Date(`2026-10-18T${hhmm}:00Z`);

  it("behaves like the adapter", async () => {
    const admin = new InMemoryJobAdmin();
    // The fake ignores `now` where the adapter uses it, so calls go through the port.
    const port: JobAdmin = admin;
    const uow = await new FakeUnitOfWorkFactory().begin();
    admin.add({
      id: "a",
      type: "media.upload",
      payload: { mediaId: "m1" },
      finishedAt: at("10:00"),
    });
    admin.add({ id: "b", type: "media.upload", finishedAt: at("11:00") });
    admin.add({ id: "c", type: "media.upload", finishedAt: at("09:00") });
    admin.add({
      id: "d",
      type: "email.staff_notification",
      payload: { submissionId: "s1" },
      finishedAt: at("08:00"),
    });

    expect((await admin.listDead(10)).map((j) => j.id)).toEqual(["b", "a", "c", "d"]);
    expect((await admin.listDead(1)).map((j) => j.id)).toEqual(["b"]);
    expect(
      (await admin.deadFor({ submissionId: "s1", mediaIds: ["m1", "m2"] })).map((j) => j.id),
    ).toEqual(["a", "d"]);
    const ofType = await admin.deadOfType("media.upload", 2);
    expect(ofType.count).toBe(3);
    expect(ofType.jobs.map((j) => j.id)).toEqual(["b", "a"]);

    expect(await port.retry(uow, "a", NOW)).toBe("media.upload");
    expect(await port.retry(uow, "a", NOW)).toBeNull();
    expect(await port.retry(uow, "missing", NOW)).toBeNull();
    expect(admin.jobs.find((j) => j.id === "a")).toMatchObject({
      status: "pending",
      attempts: 0,
      finishedAt: null,
    });
    expect((await admin.deadOfType("media.upload", 5)).count).toBe(2);

    expect(await admin.discard(uow, "b", "provider gone", NOW)).toBe("media.upload");
    expect(await admin.discard(uow, "b", "again", NOW)).toBeNull();
    expect(admin.jobs.find((j) => j.id === "b")).toMatchObject({
      status: "discarded",
      discardReason: "provider gone",
      finishedAt: NOW,
    });

    expect(await port.retryAllOfType(uow, "media.upload", NOW)).toEqual(["c"]);
    expect(admin.jobs.find((j) => j.id === "d")?.status).toBe("dead");

    expect(await port.heartbeatAgeSeconds(NOW)).toBeNull();
    admin.heartbeatAge = 30;
    expect(await port.heartbeatAgeSeconds(NOW)).toBe(30);
  });

  it("generates an id when none is given", () => {
    const admin = new InMemoryJobAdmin();
    admin.add({ type: "media.upload" });
    admin.add({ type: "media.upload" });
    const [first, second] = admin.jobs;
    expect(first?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
  });
});

describe("InMemoryJobQueue", () => {
  it("records jobs, honours unique keys, and fails on request", async () => {
    const queue = new InMemoryJobQueue();
    const uow = await new FakeUnitOfWorkFactory().begin();
    expect(await queue.enqueue(uow, "media.upload", { mediaId: "m1" })).toMatch(/^job-/);
    expect(await queue.enqueue(uow, "x", {}, { uniqueKey: "k" })).not.toBeNull();
    expect(await queue.enqueue(uow, "x", {}, { uniqueKey: "k" })).toBeNull();
    queue.failAt = 3;
    await expect(queue.enqueue(uow, "y", {})).rejects.toThrow(/injected/);
    expect(queue.ofType("media.upload")).toEqual([
      { type: "media.upload", payload: { mediaId: "m1" }, opts: {} },
    ]);
  });
});

describe("RecordingLogger", () => {
  it("shares lines with its children and merges their fields", () => {
    const logger = new RecordingLogger();
    logger.child({ jobId: "j1" }).info("done", { count: 2 });
    expect(logger.lines).toEqual([
      { level: "info", msg: "done", fields: { jobId: "j1", count: 2 } },
    ]);
  });
});
