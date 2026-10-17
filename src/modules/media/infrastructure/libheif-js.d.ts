/** libheif-js ships no types. Only the part the image encoder uses is declared. */
declare module "libheif-js/wasm-bundle" {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      done: (result: { data: Uint8ClampedArray } | null) => void,
    ): void;
    /** Releases the image handle. Idempotent. */
    free(): void;
  }

  export interface HeifDecoder {
    /** Pointer to the WASM context, null before the first decode. */
    decoder: number | null;
    decode(bytes: Uint8Array): HeifImage[];
  }

  const libheif: {
    HeifDecoder: new () => HeifDecoder;
    HeifImage: { prototype: HeifImage };
    /** Frees a context allocated by a decoder. */
    heif_context_free(context: number): void;
  };

  export default libheif;
}
