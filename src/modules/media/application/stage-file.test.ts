import { describe, expect, it } from "vitest";
import { brokenMp4, syntheticMp4 } from "../../../../tests/fakes/media-files";
import { stageFile } from "./stage-file";
import { fakeImage, makeMediaDeps } from "./testing/fakes";

const MB = 1024 * 1024;

describe("stageFile", () => {
  it("re-encodes an accepted image and stages it under the record prefix", async () => {
    const deps = makeMediaDeps();
    const r = await stageFile(deps, {
      recordId: "rec-1",
      bytes: fakeImage("image/jpeg"),
      accept: ["image"],
      maxBytes: 10 * MB,
    });
    if (!r.ok) throw new Error(r.code);
    expect(r.file).toMatchObject({ kind: "image", contentType: "image/jpeg" });
    expect(r.file.stagingRef).toBe(`in-progress/rec-1/${r.file.id}.jpg`);
    const stored = deps.staging.files.get(r.file.stagingRef);
    expect(new TextDecoder().decode(stored?.bytes)).toMatch(/^reencoded:/);
    expect(r.file.size).toBe(stored?.bytes.length);
  });

  it("stores a well-formed video as received", async () => {
    const deps = makeMediaDeps();
    const bytes = syntheticMp4();
    const r = await stageFile(deps, {
      recordId: "rec-1",
      bytes,
      accept: ["image", "video"],
      maxBytes: 10 * MB,
    });
    if (!r.ok) throw new Error(r.code);
    expect(r.file).toMatchObject({ kind: "video", contentType: "video/mp4" });
    expect(deps.staging.files.get(r.file.stagingRef)?.bytes).toEqual(bytes);
  });

  it("refuses by size, content type, kind and decoding, staging nothing", async () => {
    const deps = makeMediaDeps();
    const cases = [
      [
        { bytes: fakeImage("image/jpeg", 2 * MB), accept: ["image"], maxBytes: MB },
        "file_too_large",
      ],
      [
        { bytes: new TextEncoder().encode("<html>"), accept: ["image"], maxBytes: MB },
        "file_wrong_type",
      ],
      [{ bytes: syntheticMp4(), accept: ["image"], maxBytes: MB }, "file_wrong_type"],
      [{ bytes: fakeImage("image/gif"), accept: ["image"], maxBytes: MB }, "file_wrong_type"],
      [
        {
          bytes: new TextEncoder().encode("mime:image/png;broken"),
          accept: ["image"],
          maxBytes: MB,
        },
        "file_unreadable",
      ],
      [{ bytes: brokenMp4(), accept: ["video"], maxBytes: MB }, "file_unreadable"],
    ] as const;
    for (const [input, code] of cases) {
      expect(await stageFile(deps, { recordId: "rec-1", ...input })).toEqual({ ok: false, code });
    }
    expect(deps.staging.files.size).toBe(0);
  });
});
