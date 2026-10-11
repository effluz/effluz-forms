import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorage } from "@/modules/media/infrastructure/local-disk-storage";

describe("LocalDiskStorage", () => {
  let root: string;
  let storage: LocalDiskStorage;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "effluz-staging-"));
    storage = new LocalDiskStorage(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("puts, reads, checks and deletes a file under its key, owner-only", async () => {
    const ref = await storage.put(new Uint8Array([1, 2, 3]), "in-progress/rec/a.jpg", "image/jpeg");
    expect(ref).toBe("in-progress/rec/a.jpg");
    expect(await storage.read(ref)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await storage.exists(ref)).toBe(true);
    expect((await stat(path.join(root, ref))).mode & 0o777).toBe(0o600);
    await storage.delete(ref);
    await storage.delete(ref);
    expect(await storage.exists(ref)).toBe(false);
  });

  it("overwrites the same key and leaves no temporary files", async () => {
    await storage.put(new Uint8Array([1]), "in-progress/rec/a.jpg", "image/jpeg");
    await storage.put(new Uint8Array([2]), "in-progress/rec/a.jpg", "image/jpeg");
    expect(await storage.read("in-progress/rec/a.jpg")).toEqual(new Uint8Array([2]));
    expect(await readdir(path.join(root, "in-progress/rec"))).toEqual(["a.jpg"]);
  });

  it("deletes a whole prefix and removes emptied directories", async () => {
    for (const key of ["in-progress/one/a.jpg", "in-progress/one/b.jpg", "in-progress/two/c.jpg"])
      await storage.put(new Uint8Array([1]), key, "image/jpeg");
    await storage.deletePrefix("in-progress/one/");
    expect(await readdir(path.join(root, "in-progress"))).toEqual(["two"]);
    await storage.deletePrefix("in-progress/one/");
    await storage.delete("in-progress/two/c.jpg");
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses refs that escape the root", async () => {
    const bytes = new Uint8Array([1]);
    await expect(storage.put(bytes, "../outside.jpg", "image/jpeg")).rejects.toThrow(/escapes/);
    await expect(storage.put(bytes, "a/../../outside.jpg", "image/jpeg")).rejects.toThrow(
      /escapes/,
    );
    await expect(storage.put(bytes, "a\\b.jpg", "image/jpeg")).rejects.toThrow(/escapes/);
    await expect(storage.read("/etc/passwd")).rejects.toThrow(/escapes/);
    await expect(storage.exists("../outside.jpg")).rejects.toThrow(/escapes/);
    await expect(storage.delete("../outside.jpg")).rejects.toThrow(/escapes/);
    await expect(storage.deletePrefix("../")).rejects.toThrow(/escapes/);
    await expect(storage.deletePrefix("")).rejects.toThrow(/escapes/);
    await expect(storage.deletePrefix(".")).rejects.toThrow(/escapes/);
  });

  it("gives the admin view path for a ref", async () => {
    expect(await storage.viewUrl("in-progress/rec/a.jpg", 60)).toBe(
      "/admin/media/local/in-progress%2Frec%2Fa.jpg",
    );
    const custom = new LocalDiskStorage(root, (ref) => `/x/${ref}`);
    expect(await custom.viewUrl("k", 60)).toBe("/x/k");
  });
});
