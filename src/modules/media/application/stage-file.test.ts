import { describe, expect, it } from "vitest";
import { brokenMp4, syntheticMp4 } from "../../../../tests/fakes/media-files";
import { stageFile } from "./stage-file";
import { fakeImage, makeMediaDeps } from "./testing/fakes";

const MB = 1024 * 1024;
const RECORD = "00000001-0000-4000-8000-000000000001";

describe("stageFile", () => {
  it("re-encodes an accepted image and stages it under the record prefix", async () => {
    const deps = makeMediaDeps();
    const r = await stageFile(deps, {
      recordId: RECORD,
      bytes: fakeImage("image/jpeg"),
      accept: ["image"],
      maxBytes: 10 * MB,
    });
    if (!r.ok) throw new Error(r.code);
    expect(r.file).toMatchObject({ kind: "image", contentType: "image/jpeg" });
    expect(r.file.stagingRef).toBe(`in-progress/${RECORD}/${r.file.id}.jpg`);
    const stored = deps.staging.files.get(r.file.stagingRef);
    expect(new TextDecoder().decode(stored?.bytes)).toMatch(/^reencoded:/);
    expect(r.file.size).toBe(stored?.bytes.length);
  });

  it("stores a well-formed video as received", async () => {
    const deps = makeMediaDeps();
    const bytes = syntheticMp4();
    const r = await stageFile(deps, {
      recordId: RECORD,
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
      expect(await stageFile(deps, { recordId: RECORD, ...input })).toEqual({ ok: false, code });
    }
    expect(deps.staging.files.size).toBe(0);
  });

  it("refuses an image that grows past the limit when it is re-encoded, staging nothing", async () => {
    const deps = makeMediaDeps();
    // The fake encoder prefixes "reencoded:" (10 bytes), so this fits before and not after.
    const bytes = fakeImage("image/jpeg", 100);
    const r = await stageFile(deps, {
      recordId: RECORD,
      bytes,
      accept: ["image"],
      maxBytes: 105,
    });
    expect(r).toEqual({ ok: false, code: "file_too_large" });
    expect(deps.staging.files.size).toBe(0);
  });
});
