export interface EncodedImage {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}

/** Decodes and re-encodes an image, dropping metadata. See specs/system/media-storage.md, "File handling rules". */
export interface ImageEncoder {
  /** Null when the bytes do not decode. */
  reencode(bytes: Uint8Array, contentType: string): Promise<EncodedImage | null>;
  /** WebP at most `maxSide` px on the longer side, metadata stripped; null when the bytes do not decode. */
  thumbnail(bytes: Uint8Array, contentType: string, maxSide: number): Promise<Uint8Array | null>;
}
