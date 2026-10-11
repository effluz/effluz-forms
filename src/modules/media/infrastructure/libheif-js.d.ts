/** libheif-js ships no types. Only the part the image encoder uses is declared. */
declare module "libheif-js/wasm-bundle" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      done: (result: { data: Uint8ClampedArray } | null) => void,
    ): void;
  }

  const libheif: {
    HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] };
  };

  export default libheif;
}
