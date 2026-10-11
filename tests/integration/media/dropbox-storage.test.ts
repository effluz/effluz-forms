import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DropboxStorage } from "@/modules/media/infrastructure/dropbox-storage";
import { startFakeDropbox, type FakeDropbox } from "../../fakes/dropbox-api";

describe("DropboxStorage against a fake Dropbox", () => {
  let fake: FakeDropbox;
  let clock: number;
  let storage: DropboxStorage;
  beforeEach(async () => {
    fake = await startFakeDropbox();
    clock = Date.parse("2026-10-10T12:00:00Z");
    storage = new DropboxStorage({
      appKey: "app-key",
      appSecret: "app-secret",
      refreshToken: "refresh-token",
      apiUrl: fake.url,
      contentUrl: fake.url,
      now: () => clock,
    });
  });
  afterEach(() => fake.close());

  const key = "forms/historia-prematuro-2026/HP-0001/01-photos.jpg";

  it("exchanges the refresh token once, uploads with overwrite, and answers exists", async () => {
    const ref = await storage.put(new Uint8Array([1, 2]), key, "image/jpeg");
    expect(ref).toBe(`/${key}`);
    expect(fake.files.get(ref)).toEqual(new Uint8Array([1, 2]));
    expect(await storage.exists(ref)).toBe(true);
    expect(await storage.exists("/forms/missing.jpg")).toBe(false);
    expect(fake.tokenRefreshes).toBe(1);
  });

  it("renews the access token once on a 401 and retries the call", async () => {
    await storage.put(new Uint8Array([1]), key, "image/jpeg");
    fake.revokeTokens();
    expect(await storage.exists(`/${key}`)).toBe(true);
    expect(fake.tokenRefreshes).toBe(2);
  });

  it("treats deleting a missing file as success", async () => {
    await storage.put(new Uint8Array([1]), key, "image/jpeg");
    await storage.delete(`/${key}`);
    await storage.delete(`/${key}`);
    expect(fake.files.size).toBe(0);
  });

  it("caches temporary links for less than their four hours", async () => {
    await storage.put(new Uint8Array([1]), key, "image/jpeg");
    const first = await storage.viewUrl(`/${key}`, 3600);
    expect(first).toBe(`https://dl.example.com/${key}`);
    await storage.viewUrl(`/${key}`, 3600);
    expect(fake.calls.filter((c) => c === "/2/files/get_temporary_link")).toHaveLength(1);
    clock += 3600 * 1000;
    await storage.viewUrl(`/${key}`, 3600);
    expect(fake.calls.filter((c) => c === "/2/files/get_temporary_link")).toHaveLength(2);
  });

  it("throws a retryable error naming only the endpoint and status on 429 and 5xx", async () => {
    fake.failNext(429);
    await expect(storage.put(new Uint8Array([1]), key, "image/jpeg")).rejects.toThrow(
      "dropbox files/upload failed with 429",
    );
    fake.failNext(503);
    await expect(storage.exists(`/${key}`)).rejects.toThrow(
      "dropbox files/get_metadata failed with 503",
    );
  });

  it("is idempotent for the same key and sends a non-ASCII key as an ASCII header", async () => {
    const accented = "forms/historia-prematuro-2026/HP-0002/01-fotos-ñ.jpg";
    await storage.put(new Uint8Array([1]), accented, "image/jpeg");
    await storage.put(new Uint8Array([2]), accented, "image/jpeg");
    expect(fake.files.get(`/${accented}`)).toEqual(new Uint8Array([2]));
    expect(fake.files.size).toBe(1);
  });

  it("drops the cached link when the file is deleted", async () => {
    await storage.put(new Uint8Array([1]), key, "image/jpeg");
    await storage.viewUrl(`/${key}`, 3600);
    await storage.delete(`/${key}`);
    await storage.put(new Uint8Array([1]), key, "image/jpeg");
    await storage.viewUrl(`/${key}`, 3600);
    expect(fake.calls.filter((c) => c === "/2/files/get_temporary_link")).toHaveLength(2);
  });

  it("renews the access token shortly before it expires", async () => {
    await storage.put(new Uint8Array([1]), key, "image/jpeg");
    clock += (14400 - 61) * 1000;
    await storage.exists(`/${key}`);
    expect(fake.tokenRefreshes).toBe(1);
    clock += 2000;
    await storage.exists(`/${key}`);
    expect(fake.tokenRefreshes).toBe(2);
  });

  it("does not put a path or token in an error message", async () => {
    fake.failNext(500);
    const error = await storage.exists(`/${key}`).catch((e: unknown) => e as Error);
    expect((error as Error).message).toBe("dropbox files/get_metadata failed with 500");
  });
});
