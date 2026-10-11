import { describe, expect, it } from "vitest";
import { discardRecordFiles, discardStaged } from "./discard";
import { fakeImage, makeMediaDeps } from "./testing/fakes";

describe("discard", () => {
  it("deletes given refs, tolerating missing ones, and whole record prefixes", async () => {
    const deps = makeMediaDeps();
    for (const key of ["in-progress/a/1.jpg", "in-progress/a/2.jpg", "in-progress/b/3.jpg"])
      await deps.staging.put(fakeImage(), key, "image/jpeg");

    await discardStaged(deps, ["in-progress/a/1.jpg", "in-progress/a/missing.jpg"]);
    expect([...deps.staging.files.keys()].sort()).toEqual([
      "in-progress/a/2.jpg",
      "in-progress/b/3.jpg",
    ]);

    await discardRecordFiles(deps, "a");
    expect([...deps.staging.files.keys()]).toEqual(["in-progress/b/3.jpg"]);
  });
});
