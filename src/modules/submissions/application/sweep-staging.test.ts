import { describe, expect, it } from "vitest";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { recordHash } from "../domain/record-hash";
import { postContext } from "./post-context";
import { savePage } from "./save-page";
import { sweepStaging } from "./sweep-staging";
import { makeSubmissionsDeps, post, publishStory, type FakeSubmissionsDeps } from "./testing/fakes";

const DAY = 24 * 60 * 60 * 1000;
const ORPHAN = "00000000-0000-4000-8000-0000000000a1";
const SUBMITTED = "00000000-0000-4000-8000-0000000000a2";

async function stage(deps: FakeSubmissionsDeps, recordId: string, name = "f1.jpg") {
  await deps.media.staging.put(fakeImage(), `in-progress/${recordId}/${name}`, "image/jpeg");
}

async function startRecord(deps: FakeSubmissionsDeps): Promise<string> {
  const ctx = await postContext(deps, {
    slug: "story-form",
    state: { kind: "none" },
    submitToken: null,
  });
  if (!ctx.ok) throw new Error(ctx.outcome.kind);
  const out = await savePage(
    deps,
    ctx,
    post({ answers: { f_name: "Ana Prueba", f_baby: "yes_opt" } }),
  );
  if (out.kind !== "show") throw new Error(out.kind);
  return out.recordId;
}

/** A media row whose staging copy still waits under `recordId`'s prefix for media.upload. */
function awaitingUpload(deps: FakeSubmissionsDeps, recordId: string) {
  deps.media.media.rows.set("m1", {
    id: "m1",
    submissionId: "s1",
    formId: "f1",
    fieldKey: "f_photos",
    position: 1,
    kind: "image",
    status: "failed",
    contentType: "image/jpeg",
    size: 64,
    stagingRef: `in-progress/${recordId}/m1.jpg`,
    durableKey: "forms/story-form/ST-0001/01-photos.jpg",
    providerRef: null,
    createdAt: deps.clock.now(),
    updatedAt: deps.clock.now(),
  });
}

describe("sweepStaging", () => {
  it("removes prefixes older than 24 hours that no record and no media row claims", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const live = await startRecord(deps);
    await stage(deps, live);
    await stage(deps, ORPHAN);
    await stage(deps, SUBMITTED, "m1.jpg");
    awaitingUpload(deps, SUBMITTED);
    await stage(deps, "not-a-uuid");
    deps.clock.advance(DAY);
    const fresh = "00000000-0000-4000-8000-0000000000a3";
    await stage(deps, fresh);

    expect(await sweepStaging(deps, { now: deps.clock.now(), logger: deps.logger })).toBe(1);
    const left = [...deps.media.staging.files.keys()].map((k) => k.split("/")[1]).sort();
    expect(left).toEqual([live, SUBMITTED, fresh, "not-a-uuid"].sort());
    expect(deps.logger.lines.at(-1)).toMatchObject({
      msg: "orphaned staging prefixes removed",
      fields: { removed: 1 },
    });
  });

  it("keeps a prefix it could not remove, logging its hash, and goes on with the others", async () => {
    const deps = makeSubmissionsDeps();
    const other = "00000000-0000-4000-8000-0000000000a4";
    await stage(deps, ORPHAN);
    await stage(deps, other);
    deps.clock.advance(DAY);
    const real = deps.media.staging.deletePrefix.bind(deps.media.staging);
    deps.media.staging.deletePrefix = (prefix) =>
      prefix.includes(ORPHAN) ? Promise.reject(new Error("disk unavailable")) : real(prefix);

    expect(await sweepStaging(deps, { now: deps.clock.now(), logger: deps.logger })).toBe(1);
    expect([...deps.media.staging.files.keys()]).toEqual([`in-progress/${ORPHAN}/f1.jpg`]);
    expect(
      deps.logger.lines.some((l) => l.level === "warn" && l.fields.recordHash === recordHash(ORPHAN)),
    ).toBe(true);
    expect(JSON.stringify(deps.logger.lines)).not.toContain(ORPHAN);
  });

  it("does nothing when nothing was ever staged", async () => {
    const deps = makeSubmissionsDeps();
    expect(await sweepStaging(deps, { now: deps.clock.now(), logger: deps.logger })).toBe(0);
  });
});
