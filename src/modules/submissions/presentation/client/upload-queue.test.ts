import { describe, expect, it } from "vitest";
import { middleEllipsis, precheckFile, queueReducer, type Row } from "./upload-queue";

const row = (localId: string): Row => ({
  localId,
  id: null,
  name: `${localId}.jpg`,
  size: "12 kB",
  kind: "image",
  thumb: null,
  state: { status: "uploading", percent: 0 },
});

describe("queueReducer", () => {
  it("tracks progress, success, failure, retry and removal per file", () => {
    let rows = queueReducer([], { type: "add", rows: [row("a"), row("b")] });
    rows = queueReducer(rows, { type: "progress", localId: "a", percent: 40 });
    rows = queueReducer(rows, { type: "done", localId: "a", id: "srv-a", label: "File 1, 12 kB" });
    rows = queueReducer(rows, {
      type: "fail",
      localId: "b",
      message: "b.jpg did not upload. Check your connection and retry",
    });
    expect(rows.map((r) => [r.localId, r.id, r.state.status])).toEqual([
      ["a", "srv-a", "uploaded"],
      ["b", null, "failed"],
    ]);
    rows = queueReducer(rows, { type: "retry", localId: "b" });
    expect(rows[1]?.state).toEqual({ status: "uploading", percent: 0 });
    rows = queueReducer(rows, { type: "remove", localId: "a" });
    expect(rows.map((r) => r.localId)).toEqual(["b"]);
  });

  it("adds a pre-checked refusal as a failed row that never uploads", () => {
    const refused: Row = {
      ...row("c"),
      state: { status: "failed", message: "c.jpg is larger than 10 MB" },
    };
    expect(queueReducer([], { type: "add", rows: [refused] })[0]?.state).toEqual({
      status: "failed",
      message: "c.jpg is larger than 10 MB",
    });
  });

  it("truncates long names in the middle", () => {
    expect(middleEllipsis("IMG_20261010_123456789_HDR_final.jpeg", 20)).toBe(
      "IMG_20261…final.jpeg",
    );
    expect(middleEllipsis("short.jpg", 20)).toBe("short.jpg");
  });
});

describe("precheckFile", () => {
  const limits = { maxBytes: 10 * 1024 * 1024, kinds: ["image"] as const };
  it("refuses by declared size and kind before uploading, and lets an unknown type through to the server", () => {
    expect(precheckFile({ size: 11 * 1024 * 1024, type: "image/jpeg" }, limits)).toBe(
      "file_too_large",
    );
    expect(precheckFile({ size: 1024, type: "video/mp4" }, limits)).toBe("file_wrong_type");
    expect(precheckFile({ size: 1024, type: "image/heic" }, limits)).toBeNull();
    expect(precheckFile({ size: 1024, type: "" }, limits)).toBeNull();
  });
});
