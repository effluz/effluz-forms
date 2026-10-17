import { describe, expect, it } from "vitest";
import { FakeUnitOfWorkFactory, InMemoryJobQueue, RecordingLogger } from "./fakes";

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
