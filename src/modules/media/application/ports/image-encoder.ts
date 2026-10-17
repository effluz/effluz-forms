export interface EncodedImage {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}

/** Decodes and re-encodes an image, dropping metadata. See specs/system/media-storage.md, "File handling rules". */
export interface ImageEncoder {
  /** Null when the bytes do not decode. */
  reencode(bytes: Uint8Array, contentType: string): Promise<EncodedImage | null>;
}
