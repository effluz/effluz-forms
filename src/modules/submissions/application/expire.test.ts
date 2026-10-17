import { describe, expect, it } from "vitest";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { recordHash } from "../domain/record-hash";
import { expireInProgress } from "./expire";
import { postContext } from "./post-context";
import { savePage } from "./save-page";
import { makeSubmissionsDeps, post, publishStory, type FakeSubmissionsDeps } from "./testing/fakes";
import { uploadFile } from "./upload-file";

async function startRecord(deps: FakeSubmissionsDeps): Promise<string> {
  const none = await postContext(deps, {
    slug: "story-form",
    state: { kind: "none" },
    submitToken: null,
  });
  if (!none.ok) throw new Error("closed");
  const out = await savePage(
    deps,
    none,
    post({ answers: { f_name: "Ana Prueba", f_baby: "yes_opt" } }),
  );
  if (out.kind !== "show") throw new Error(out.kind);
  return out.recordId;
}

describe("expireInProgress", () => {
  it("removes records past 24 hours with their staged files, and keeps fresh ones", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startRecord(deps);
    const ctx = await postContext(deps, {
      slug: "story-form",
      state: { kind: "record", id },
      submitToken: null,
    });
    if (!ctx.ok) throw new Error("expired");
    await uploadFile(deps, ctx, {
      fieldKey: "f_photos",
      bytes: fakeImage(),
      renderedAt: null,
      acceptLanguage: "es",
    });
    expect(await expireInProgress(deps, { now: deps.clock.now(), logger: deps.logger })).toBe(0);
    const later = new Date(deps.clock.now().getTime() + 24 * 60 * 60 * 1000);
    expect(await expireInProgress(deps, { now: later, logger: deps.logger })).toBe(1);
    expect(deps.inProgress.rows.size).toBe(0);
    expect(deps.media.staging.files.size).toBe(0);
    expect(deps.logger.lines.at(-1)).toMatchObject({
      msg: "expired in-progress records removed",
      fields: { removed: 1 },
    });
  });

  it("keeps a record still inside its 24 hours while an older one goes", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const old = await startRecord(deps);
    deps.clock.advance(23 * 60 * 60 * 1000);
    const fresh = await startRecord(deps);
    const later = new Date(deps.clock.now().getTime() + 60 * 60 * 1000);
    expect(await expireInProgress(deps, { now: later, logger: deps.logger })).toBe(1);
    expect(deps.inProgress.rows.has(old)).toBe(false);
    expect(deps.inProgress.rows.has(fresh)).toBe(true);
  });

  it("works through the expired records in batches of the given size", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    for (let i = 0; i < 3; i += 1) await startRecord(deps);
    const later = new Date(deps.clock.now().getTime() + 24 * 60 * 60 * 1000);
    expect(await expireInProgress(deps, { now: later, logger: deps.logger, limit: 2 })).toBe(3);
    expect(deps.inProgress.rows.size).toBe(0);
  });

  it("removes an expired record whose stored row no longer parses", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startRecord(deps);
    deps.inProgress.findForUpdate = () => Promise.reject(new Error("corrupt"));
    const later = new Date(deps.clock.now().getTime() + 24 * 60 * 60 * 1000);
    expect(await expireInProgress(deps, { now: later, logger: deps.logger })).toBe(1);
    expect(deps.inProgress.rows.has(id)).toBe(false);
  });

  it("keeps a record whose files could not be removed, for the next run", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startRecord(deps);
    deps.media.staging.deletePrefix = () => Promise.reject(new Error("disk unavailable"));
    const later = new Date(deps.clock.now().getTime() + 24 * 60 * 60 * 1000);
    expect(await expireInProgress(deps, { now: later, logger: deps.logger })).toBe(0);
    expect(deps.inProgress.rows.has(id)).toBe(true);
    expect(
      deps.logger.lines.some((l) => l.level === "warn" && l.fields.recordHash === recordHash(id)),
    ).toBe(true);
    // The record id is the cookie value and never reaches a log.
    expect(JSON.stringify(deps.logger.lines)).not.toContain(id);
  });
});
