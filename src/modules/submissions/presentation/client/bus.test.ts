import { describe, expect, it } from "vitest";
import {
  inFlight,
  keepRows,
  keptRows,
  onUploadsChange,
  resetRowsFor,
  uploadFinished,
  uploadStarted,
} from "./bus";
import type { Row } from "./upload-queue";

describe("upload bus", () => {
  it("counts uploads in flight and tells listeners", () => {
    const seen: number[] = [];
    const off = onUploadsChange((n) => seen.push(n));
    uploadStarted();
    uploadStarted();
    uploadFinished();
    off();
    uploadFinished();
    expect(seen).toEqual([1, 2, 1]);
    expect(inFlight()).toBe(0);
  });

  it("keeps a field's rows across a remount until the next server render", () => {
    const kept: Row = {
      localId: "a",
      id: "srv-a",
      name: "a.jpg",
      size: "12 kB",
      kind: "image",
      thumb: null,
      state: { status: "uploaded" },
    };
    resetRowsFor("r1");
    keepRows("f_photos", [kept]);
    expect(keptRows("f_photos")).toEqual([kept]);
    resetRowsFor("r1");
    expect(keptRows("f_photos")).toEqual([kept]);
    resetRowsFor("r2");
    expect(keptRows("f_photos")).toBeNull();
  });
});
