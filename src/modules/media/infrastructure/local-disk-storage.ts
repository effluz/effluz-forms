import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ListedPrefix, StagingStorage } from "../application/ports/media-storage";

const ESCAPE_MESSAGE = "media ref escapes the storage root";

function defaultViewPath(ref: string): string {
  return `/admin/media/local/${encodeURIComponent(ref)}`;
}

/**
 * Files on local disk under one root: the staging tier, and the durable tier
 * when `MEDIA_PROVIDER=local`. See specs/system/media-storage.md.
 *
 * `viewPath` maps a ref to the admin route that streams it.
 */
export class LocalDiskStorage implements StagingStorage {
  private readonly root: string;

  constructor(
    root: string,
    private readonly viewPath: (ref: string) => string = defaultViewPath,
  ) {
    this.root = path.resolve(root);
  }

  // The content type is part of the port; disk needs no metadata for it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async put(bytes: Uint8Array, key: string, _contentType: string): Promise<string> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, bytes, { mode: 0o600 });
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return key;
  }

  refForKey(key: string): string {
    return key;
  }

  async read(ref: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(ref)));
  }

  async openRead(ref: string): Promise<ReadableStream<Uint8Array>> {
    const file = this.resolve(ref);
    // Rejects for a missing file, before a stream exists to fail later.
    if (!(await stat(file)).isFile()) throw new Error("media file is missing");
    return Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  }

  // A local view path does not expire; the admin route checks the session.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  viewUrl(ref: string, _ttlSeconds: number): Promise<string> {
    return Promise.resolve(this.viewPath(ref));
  }

  async delete(ref: string): Promise<void> {
    const file = this.resolve(ref);
    await rm(file, { force: true });
    await this.pruneEmptyParents(path.dirname(file));
  }

  async exists(ref: string): Promise<boolean> {
    const file = this.resolve(ref);
    try {
      return (await stat(file)).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    const dir = this.resolve(prefix);
    if (dir === this.root) throw new Error(ESCAPE_MESSAGE);
    await rm(dir, { recursive: true, force: true });
    await this.pruneEmptyParents(path.dirname(dir));
  }

  /** The directories directly under `root`, each with its modification time. */
  async listPrefixes(root: string): Promise<ListedPrefix[]> {
    const base = root.endsWith("/") ? root : `${root}/`;
    const dir = this.resolve(base);
    let names: string[];
    try {
      names = (await readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      // Never the system error itself: its message carries the directory path, which under
      // the staging root is a record id.
      throw new Error(`could not list the staging prefixes (${code ?? "unknown"})`);
    }
    const listed: ListedPrefix[] = [];
    for (const name of names) {
      try {
        const { mtime } = await stat(path.join(dir, name));
        listed.push({ prefix: `${base}${name}/`, modifiedAt: mtime });
      } catch (error) {
        // Removed between the listing and the stat: nothing left to report.
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") continue;
        throw new Error(`could not stat a staging prefix (${code ?? "unknown"})`);
      }
    }
    return listed;
  }

  /** Resolves a ref under the root or throws; refuses absolute paths and backslashes. */
  private resolve(ref: string): string {
    if (ref.includes("\\") || ref.includes("\0") || path.isAbsolute(ref)) {
      throw new Error(ESCAPE_MESSAGE);
    }
    const resolved = path.resolve(this.root, ref);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(ESCAPE_MESSAGE);
    }
    return resolved;
  }

  /** Removes emptied directories upward, stopping before the root. */
  private async pruneEmptyParents(dir: string): Promise<void> {
    let current = dir;
    while (current !== this.root && current.startsWith(this.root + path.sep)) {
      try {
        if ((await readdir(current)).length > 0) return;
        await rmdir(current);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOTEMPTY") return;
        if (code !== "ENOENT") throw error;
      }
      current = path.dirname(current);
    }
  }
}
