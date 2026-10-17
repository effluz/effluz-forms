import { describe, expect, it } from "vitest";
import { discardRecordFiles, discardStaged } from "./discard";
import { fakeImage, makeMediaDeps } from "./testing/fakes";

const A = "0000000a-0000-4000-8000-00000000000a";
const B = "0000000b-0000-4000-8000-00000000000b";

describe("discard", () => {
  it("deletes given refs, tolerating missing ones, and whole record prefixes", async () => {
    const deps = makeMediaDeps();
    for (const key of [
      `in-progress/${A}/1.jpg`,
      `in-progress/${A}/2.jpg`,
      `in-progress/${B}/3.jpg`,
    ])
      await deps.staging.put(fakeImage(), key, "image/jpeg");

    await discardStaged(deps, [`in-progress/${A}/1.jpg`, `in-progress/${A}/missing.jpg`]);
    expect([...deps.staging.files.keys()].sort()).toEqual([
      `in-progress/${A}/2.jpg`,
      `in-progress/${B}/3.jpg`,
    ]);

    await discardRecordFiles(deps, A);
    expect([...deps.staging.files.keys()]).toEqual([`in-progress/${B}/3.jpg`]);
  });
});
