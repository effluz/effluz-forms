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
    expect(first).toBe(`${fake.url}/dl/${key}`);
    await storage.viewUrl(`/${key}`, 3600);
    expect(fake.calls.filter((c) => c === "/2/files/get_temporary_link")).toHaveLength(1);
    clock += 3600 * 1000;
    await storage.viewUrl(`/${key}`, 3600);
    expect(fake.calls.filter((c) => c === "/2/files/get_temporary_link")).toHaveLength(2);
  });

  it("streams a file through its temporary link", async () => {
    await storage.put(new Uint8Array([7, 8, 9]), key, "image/jpeg");
    const stream = await storage.openRead(`/${key}`);
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(
      new Uint8Array([7, 8, 9]),
    );
    expect(fake.calls).toContain("/2/files/get_temporary_link");
    await expect(storage.openRead("/forms/missing.jpg")).rejects.toThrow(
      "dropbox files/get_temporary_link failed with 409",
    );
  });

  it("rejects a download that fails, naming only the status", async () => {
    const link = new DropboxStorage({
      appKey: "app-key",
      appSecret: "app-secret",
      refreshToken: "refresh-token",
      apiUrl: fake.url,
      contentUrl: fake.url,
      fetch: (input, init) =>
        typeof input === "string" && input.includes("/dl/")
          ? Promise.resolve(new Response(null, { status: 404 }))
          : fetch(input, init),
    });
    await link.put(new Uint8Array([1]), key, "image/jpeg");
    await expect(link.openRead(`/${key}`)).rejects.toThrow("dropbox download failed with 404");
  });

  it("asks for a fresh temporary link after a download through the cached one fails", async () => {
    let failed = false;
    const link = new DropboxStorage({
      appKey: "app-key",
      appSecret: "app-secret",
      refreshToken: "refresh-token",
      apiUrl: fake.url,
      contentUrl: fake.url,
      fetch: (input, init) => {
        if (!failed && typeof input === "string" && input.includes("/dl/")) {
          failed = true;
          return Promise.resolve(new Response(null, { status: 410 }));
        }
        return fetch(input, init);
      },
    });
    await link.put(new Uint8Array([4, 5]), key, "image/jpeg");
    await expect(link.openRead(`/${key}`)).rejects.toThrow("dropbox download failed with 410");

    const stream = await link.openRead(`/${key}`);
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(
      new Uint8Array([4, 5]),
    );
    expect(fake.calls.filter((c) => c === "/2/files/get_temporary_link")).toHaveLength(2);
  });

  it("stops the download timer once the headers arrive, so a slow body can drain", async () => {
    const slow = new DropboxStorage({
      appKey: "app-key",
      appSecret: "app-secret",
      refreshToken: "refresh-token",
      apiUrl: fake.url,
      contentUrl: fake.url,
      requestTimeoutMs: 30,
      fetch: (input, init) => {
        if (typeof input !== "string" || !input.includes("/dl/")) return fetch(input, init);
        // Like fetch: an abort of the request's signal errors a body still being read.
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            let aborted = false;
            init?.signal?.addEventListener("abort", () => {
              aborted = true;
              controller.error(new Error("aborted"));
            });
            setTimeout(() => {
              if (aborted) return;
              controller.enqueue(new Uint8Array([6]));
              controller.close();
            }, 90);
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      },
    });
    await slow.put(new Uint8Array([6]), key, "image/jpeg");

    const stream = await slow.openRead(`/${key}`);
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(new Uint8Array([6]));
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
    for (const raw of fake.uploadArgs) {
      expect(Buffer.from(raw, "latin1").every((byte) => byte < 128)).toBe(true); // ASCII only
      expect(raw).toContain("\\u00f1");
      expect(JSON.parse(raw)).toMatchObject({ path: `/${accented}`, mode: "overwrite" });
    }
  });

  it("gives a file whose reference was never recorded the same reference put returns", async () => {
    const ref = await storage.put(new Uint8Array([1]), key, "image/jpeg");
    expect(storage.refForKey(key)).toBe(ref);
    await storage.delete(storage.refForKey(key));
    expect(fake.files.size).toBe(0);
  });

  it("fails an upload the provider refuses as a conflict, for the job system to retry", async () => {
    await storage.put(new Uint8Array([1]), key, "image/jpeg");
    fake.failNext(409, { error_summary: "path/conflict/file/" });
    await expect(storage.put(new Uint8Array([2]), key, "image/jpeg")).rejects.toThrow(
      "dropbox files/upload failed with 409",
    );
  });

  it("gives every call a timeout, so a hung connection fails the attempt", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const spying = new DropboxStorage({
      appKey: "app-key",
      appSecret: "app-secret",
      refreshToken: "refresh-token",
      apiUrl: fake.url,
      contentUrl: fake.url,
      fetch: (input, init) => {
        signals.push(init?.signal);
        return fetch(input, init);
      },
    });
    await spying.put(new Uint8Array([1]), key, "image/jpeg");
    expect(signals).toHaveLength(2); // the token exchange and the upload
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
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
