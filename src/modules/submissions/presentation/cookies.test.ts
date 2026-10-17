import { describe, expect, it } from "vitest";
import { LIMITS } from "@/shared/domain/form-model";
import { registry, storyVersion } from "../domain/testing/versions";
import {
  clearedFillCookie,
  decodeFillPostState,
  encodeFillPostState,
  encodeFillState,
  fillCookie,
  fillCookieOptions,
  parseFillState,
  refusedEntries,
} from "./cookies";
import type { RefusedFileEntry } from "./page-form-state";

const ID = "00000000-0000-4000-8000-0000000000aa";

describe("the in-progress cookie", () => {
  it("is scoped to the form, httpOnly, lax, a day long, secure in production", () => {
    expect(fillCookie("story-form", { kind: "record", id: ID }, true)).toBe(
      `effluz_fill=${ID}; Path=/f/story-form; HttpOnly; SameSite=Lax; Max-Age=86400; Secure`,
    );
    expect(clearedFillCookie("story-form", false)).toBe(
      "effluz_fill=; Path=/f/story-form; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect(fillCookieOptions("story-form", false, 86_400)).toEqual({
      path: "/f/story-form",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 86_400,
    });
  });

  it("round-trips each state and reads anything else as none", () => {
    for (const state of [
      { kind: "record", id: ID },
      { kind: "done", submitToken: ID },
      { kind: "decoy", reference: "HP-1234" },
    ] as const) {
      expect(parseFillState(encodeFillState(state))).toEqual(state);
    }
    for (const value of [
      null,
      "",
      "nope",
      "done.not-a-uuid",
      "decoy.<script>",
      "decoy.hp-1",
      `${ID};x`,
    ]) {
      expect(parseFillState(value)).toEqual({ kind: "none" });
    }
  });
});

describe("the fill state cookie", () => {
  it("carries a refused post's files for its own redirect only, ten at most, names cut to 80", () => {
    const entry: RefusedFileEntry = {
      field: "f_photos",
      code: "file_wrong_type",
      name: "x".repeat(100),
      params: {},
    };
    const raw = encodeFillPostState({
      at: 1_790_000_000_000,
      page: 2,
      refusedFiles: Array.from({ length: 12 }, () => entry),
    });
    const decoded = decodeFillPostState(raw, "1790000000000");
    expect(decoded?.at).toBe(1_790_000_000_000);
    expect(decoded?.page).toBe(2);
    expect(decoded?.refusedFiles).toHaveLength(10);
    for (const file of decoded?.refusedFiles ?? []) expect(file.name).toHaveLength(80);
    expect(decodeFillPostState(raw, "1")).toBeNull();
    expect(decodeFillPostState(raw, null)).toBeNull();
    expect(decodeFillPostState("garbage", "1")).toBeNull();
    expect(decodeFillPostState(undefined, "1")).toBeNull();
  });

  it("drops the names first when the state would not fit a cookie", () => {
    const entry: RefusedFileEntry = {
      field: "f_photos",
      code: "file_too_large",
      name: "語".repeat(80),
      params: { maxMb: 10 },
    };
    const raw = encodeFillPostState({
      at: 1,
      page: 2,
      refusedFiles: Array.from({ length: 10 }, () => entry),
    });
    expect(raw.length).toBeLessThanOrEqual(3400);
    expect(decodeFillPostState(raw, "1")?.refusedFiles).toEqual(
      Array.from({ length: 10 }, () => ({ ...entry, name: "" })),
    );
  });

  it("records the cap that refused each file", () => {
    const version = storyVersion();
    const photos = version.pages.flatMap((p) => p.fields).find((f) => f.key === "f_photos");
    const { maxSizeMb } = photos?.settings as { maxSizeMb: number };
    expect(
      refusedEntries(
        [
          { fieldKey: "f_photos", code: "file_too_large", name: "a.jpg" },
          { fieldKey: "f_photos", code: "submission_too_large", name: "b.mp4" },
          { fieldKey: "f_photos", code: "file_unreadable", name: "c.jpg" },
        ],
        version,
        registry,
      ),
    ).toEqual([
      { field: "f_photos", code: "file_too_large", name: "a.jpg", params: { maxMb: maxSizeMb } },
      {
        field: "f_photos",
        code: "submission_too_large",
        name: "b.mp4",
        params: { maxMb: LIMITS.submissionSizeMb },
      },
      { field: "f_photos", code: "file_unreadable", name: "c.jpg", params: {} },
    ]);
  });
});
