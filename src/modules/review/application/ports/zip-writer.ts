/** One file of a ZIP, opened only when the writer reaches it. */
export interface ZipEntry {
  name: string;
  modifiedAt: Date;
  /** Null: the file is gone, and the writer skips the entry. */
  open(): Promise<ReadableStream<Uint8Array> | null>;
}

/** Streams a ZIP of the entries one at a time, so the photos never sit in memory together. */
export interface ZipWriter {
  write(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array>;
}
