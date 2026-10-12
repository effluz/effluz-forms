/** Object storage for media. See specs/system/media-storage.md, "Ports". */
export interface MediaStorage {
  /** Stores the bytes under `key`, idempotent for the same key; returns the provider reference. */
  put(bytes: Uint8Array, key: string, contentType: string): Promise<string>;
  /** The reference `put` returns for `key`, for a file whose reference was never recorded. */
  refForKey(key: string): string;
  viewUrl(ref: string, ttlSeconds: number): Promise<string>;
  /** Succeeds when the file is already gone. */
  delete(ref: string): Promise<void>;
  exists(ref: string): Promise<boolean>;
}

/** One prefix directly under a listed root, with the last time its contents changed. */
export interface ListedPrefix {
  /** `<root>/<name>/`. */
  prefix: string;
  modifiedAt: Date;
}

/**
 * The staging area also reads files back, removes a whole record prefix and
 * lists the record prefixes under its root, for the sweep of prefixes no row
 * claims (specs/system/jobs.md, "Recurring jobs").
 */
export interface StagingStorage extends MediaStorage {
  read(ref: string): Promise<Uint8Array>;
  deletePrefix(prefix: string): Promise<void>;
  /** The prefixes directly under `root`; none when nothing was ever staged there. */
  listPrefixes(root: string): Promise<ListedPrefix[]>;
}
