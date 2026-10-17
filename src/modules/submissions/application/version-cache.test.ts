import { describe, expect, it, vi } from "vitest";
import { publishAgain } from "@/modules/definitions/application/testing/fakes";
import { storyVersion } from "../domain/testing/versions";
import { makeSubmissionsDeps, publishStory } from "./testing/fakes";
import { VersionCache } from "./version-cache";

describe("VersionCache", () => {
  it("reads each version once and evicts the least recently used beyond its size", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const secondId = publishAgain(deps.definitions, formId, storyVersion());
    const spy = vi.spyOn(deps.definitions.versions, "findById");
    const cache = new VersionCache(1);
    await cache.get(deps.definitions, versionId);
    await cache.get(deps.definitions, versionId);
    expect(spy).toHaveBeenCalledTimes(1);
    await cache.get(deps.definitions, secondId);
    await cache.get(deps.definitions, versionId);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("keeps the most recently used version when it evicts", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const secondId = publishAgain(deps.definitions, formId, storyVersion());
    const thirdId = publishAgain(deps.definitions, formId, storyVersion());
    const spy = vi.spyOn(deps.definitions.versions, "findById");
    const cache = new VersionCache(2);
    await cache.get(deps.definitions, versionId);
    await cache.get(deps.definitions, secondId);
    await cache.get(deps.definitions, versionId); // versionId is now the newest
    await cache.get(deps.definitions, thirdId); // evicts secondId
    expect(spy).toHaveBeenCalledTimes(3);
    await cache.get(deps.definitions, versionId);
    expect(spy).toHaveBeenCalledTimes(3);
    await cache.get(deps.definitions, secondId);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("does not remember an unknown version", async () => {
    const deps = makeSubmissionsDeps();
    const spy = vi.spyOn(deps.definitions.versions, "findById");
    const cache = new VersionCache();
    const unknown = "00000000-0000-4000-8000-0000000000ff";
    expect(await cache.get(deps.definitions, unknown)).toBeNull();
    expect(await cache.get(deps.definitions, unknown)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
