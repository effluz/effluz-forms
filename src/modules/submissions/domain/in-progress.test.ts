import { describe, expect, it } from "vitest";
import {
  clampStartedAt,
  isExpired,
  newInProgress,
  removeUpload,
  stagedBytes,
  withFileAnswers,
} from "./in-progress";

const now = new Date("2026-10-10T12:00:00Z");
const upload = (id: string, size = 1) => ({
  id,
  stagingRef: `in-progress/r/${id}.jpg`,
  kind: "image" as const,
  contentType: "image/jpeg",
  size,
});

describe("in-progress record", () => {
  it("lives 24 hours from creation, expiring exactly at the limit", () => {
    const r = newInProgress({
      id: "r",
      formId: "f",
      versionId: "v",
      locale: "es",
      pageKey: "page_contact",
      submitToken: "t",
      startedAt: now,
      now,
    });
    expect(r.expiresAt.toISOString()).toBe("2026-10-11T12:00:00.000Z");
    expect(isExpired(r, new Date("2026-10-11T11:59:59.999Z"))).toBe(false);
    expect(isExpired(r, new Date("2026-10-11T12:00:00.000Z"))).toBe(true);
  });

  it("starts empty, with both timestamps at creation", () => {
    const r = newInProgress({
      id: "r",
      formId: "f",
      versionId: "v",
      locale: "en",
      pageKey: "page_contact",
      submitToken: "t",
      startedAt: new Date("2026-10-10T11:59:00Z"),
      now,
    });
    expect(r).toMatchObject({
      answers: {},
      files: {},
      pending: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(r.startedAt).toEqual(new Date("2026-10-10T11:59:00Z"));
  });

  it("clamps the render time into the last 24 hours, and reads absent or broken as now", () => {
    expect(clampStartedAt(new Date("2026-10-10T11:59:50Z"), now)).toEqual(
      new Date("2026-10-10T11:59:50Z"),
    );
    expect(clampStartedAt(new Date("2026-10-10T13:00:00Z"), now)).toEqual(now);
    expect(clampStartedAt(new Date("2026-10-08T00:00:00Z"), now)).toEqual(
      new Date("2026-10-09T12:00:00Z"),
    );
    expect(clampStartedAt(null, now)).toEqual(now);
    expect(clampStartedAt(new Date("garbage"), now)).toEqual(now);
  });

  it("answers file fields with the staged ids in upload order, and removes one upload", () => {
    const files = { f_photos: [upload("a"), upload("b")] };
    expect(withFileAnswers({ f_name: "Ana" }, files)).toEqual({
      f_name: "Ana",
      f_photos: ["a", "b"],
    });
    const { files: left, removed } = removeUpload(files, "a");
    expect(left).toEqual({ f_photos: [upload("b")] });
    expect(removed?.id).toBe("a");
    expect(removeUpload(files, "zzz").removed).toBeNull();
  });

  it("sums the staged sizes across fields", () => {
    expect(
      stagedBytes({ f_photos: [upload("a", 10), upload("b", 5)], f_video: [upload("c", 100)] }),
    ).toBe(115);
    expect(stagedBytes({})).toBe(0);
  });
});
