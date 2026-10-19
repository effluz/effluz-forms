import { describe, expect, it } from "vitest";
import type { MediaRecord } from "../domain/media";
import { mediaThumbnail, openMedia, openStoredKey, videoViewUrl } from "./read-media";
import { fakeImage, makeMediaDeps } from "./testing/fakes";

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<string | null> {
  if (stream === null) return null;
  const chunks: string[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(text(value));
  }
  return chunks.join("");
}

const at = new Date("2026-10-10T12:00:00.000Z");

function row(over: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: "0000000a-0000-4000-8000-00000000000a",
    submissionId: "0000000b-0000-4000-8000-00000000000b",
    formId: "0000000c-0000-4000-8000-00000000000c",
    fieldKey: "photos",
    position: 1,
    kind: "image",
    status: "stored",
    contentType: "image/jpeg",
    size: 10,
    stagingRef: "in-progress/a/1.jpg",
    durableKey: "forms/s/HP-0001/01-photos.jpg",
    providerRef: "forms/s/HP-0001/01-photos.jpg",
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

async function put(
  store: { put(bytes: Uint8Array, key: string, type: string): Promise<string> },
  key: string,
  body: string,
): Promise<void> {
  await store.put(new TextEncoder().encode(body), key, "image/jpeg");
}

describe("openMedia", () => {
  it("opens the staging copy first, else the durable file", async () => {
    const deps = makeMediaDeps();
    await put(deps.staging, "in-progress/a/1.jpg", "staging bytes");
    await put(deps.durable, "forms/s/HP-0001/01-photos.jpg", "durable bytes");

    expect(await drain(await openMedia(deps, row()))).toBe("staging bytes");
    expect(await drain(await openMedia(deps, row({ stagingRef: null, status: "stored" })))).toBe(
      "durable bytes",
    );
    expect(await openMedia(deps, row({ stagingRef: null, status: "failed" }))).toBeNull();
  });

  it("opens the durable file of a record stored after it was read", async () => {
    const deps = makeMediaDeps();
    await put(deps.durable, "forms/s/HP-0001/01-photos.jpg", "durable bytes");
    // Read while staged; the upload job then stored it and removed the staging copy.
    const stale = row({ status: "staged", providerRef: null });
    deps.media.rows.set(stale.id, {
      ...stale,
      status: "stored",
      stagingRef: null,
      providerRef: "forms/s/HP-0001/01-photos.jpg",
    });

    expect(await drain(await openMedia(deps, stale))).toBe("durable bytes");
    deps.media.rows.delete(stale.id);
    expect(await openMedia(deps, stale)).toBeNull();
  });
});

describe("mediaThumbnail", () => {
  it("makes a thumbnail of images only", async () => {
    const deps = makeMediaDeps();
    await deps.staging.put(fakeImage(), "in-progress/a/1.jpg", "image/jpeg");
    const thumb = await mediaThumbnail(deps, row());
    expect(thumb === null ? null : text(thumb)).toBe("thumb:320");

    expect(await mediaThumbnail(deps, row({ kind: "video", contentType: "video/mp4" }))).toBeNull();
    expect(
      await mediaThumbnail(deps, row({ stagingRef: null, providerRef: null, status: "failed" })),
    ).toBeNull();
    // A stored image whose durable file is missing.
    expect(await mediaThumbnail(deps, row({ stagingRef: null }))).toBeNull();
  });
});

describe("videoViewUrl", () => {
  it("gives a view URL only for a stored video without a staging copy", async () => {
    const deps = makeMediaDeps();
    const video = row({
      kind: "video",
      contentType: "video/mp4",
      stagingRef: null,
      providerRef: "forms/s/HP-0001/01-clips.mp4",
    });
    expect(await videoViewUrl(deps, video)).toBe("memory://forms/s/HP-0001/01-clips.mp4");
    expect(await videoViewUrl(deps, { ...video, stagingRef: "in-progress/a/1.mp4" })).toBeNull();
    expect(await videoViewUrl(deps, row({ stagingRef: null }))).toBeNull();
  });

  it("answers null when the provider gives no view URL", async () => {
    const deps = makeMediaDeps();
    deps.durable.viewUrl = () => Promise.reject(new Error("provider unavailable"));
    const video = row({ kind: "video", contentType: "video/mp4", stagingRef: null });
    expect(await videoViewUrl(deps, video)).toBeNull();
  });
});

describe("openStoredKey", () => {
  it("opens a stored key only under forms/", async () => {
    const deps = makeMediaDeps();
    await put(deps.durable, "forms/s/HP-0001/01-x.jpg", "kept");
    await put(deps.durable, "in-progress/a/b.jpg", "private");
    await put(deps.durable, "x", "outside");

    expect(await drain(await openStoredKey(deps, "forms/s/HP-0001/01-x.jpg"))).toBe("kept");
    expect(await openStoredKey(deps, "in-progress/a/b.jpg")).toBeNull();
    expect(await openStoredKey(deps, "forms/../x")).toBeNull();
    expect(await openStoredKey(deps, "forms/s/missing.jpg")).toBeNull();
  });
});
