/** Detects a file's real type from its bytes. See specs/system/media-storage.md, "File handling rules". */
export interface ContentSniffer {
  /** The MIME type the content shows, or null when it is not recognised. */
  sniff(bytes: Uint8Array): Promise<string | null>;
}
