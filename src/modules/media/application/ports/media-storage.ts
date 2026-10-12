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

/** The staging area also reads files back and removes a whole record prefix. */
export interface StagingStorage extends MediaStorage {
  read(ref: string): Promise<Uint8Array>;
  deletePrefix(prefix: string): Promise<void>;
}
