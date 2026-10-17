# 0023. Image processing with sharp and libheif-js, sniffing with file-type

Status: accepted
Date: 2026-10-10

## Context

Every uploaded photo must be re-encoded so that EXIF, XMP and GPS data never
reach storage (`system/media-storage.md`), and files must be accepted by
their content, never their name or declared type. Phones send JPEG, PNG,
WebP and HEIC (the iPhone default) and MP4 or QuickTime video. Options were
ImageMagick or libvips through a system binary, a WebAssembly-only stack,
or the `sharp` binding to libvips. HEIC decoding is not in sharp's
prebuilt binaries because of HEVC patent licensing.

## Decision

- `sharp` decodes and re-encodes JPEG, PNG and WebP to the same format,
  applying the EXIF orientation first and writing no metadata. Inputs above
  50 megapixels are refused.
- `libheif-js` (its WebAssembly bundle) decodes HEIC to RGBA pixels, which
  sharp encodes as JPEG. No native HEVC code is installed.
- `file-type` identifies JPEG, PNG, WebP, HEIC, MP4 and QuickTime from the
  first bytes. Anything else is refused before decoding. Videos get an ISO
  base media box walk of our own, since we store them as received.
- All three are used only in `src/modules/media/infrastructure/`, behind
  the `ContentSniffer` and `ImageEncoder` ports. `sharp` and `libheif-js`
  are listed in `serverExternalPackages` so Next.js does not bundle them.

## Consequences

- One native dependency (sharp ships prebuilt libvips for linux-x64 and
  darwin-arm64); the production image must install it for its platform.
- HEIC decoding in WebAssembly is slower than native, about a second for a
  12 MP photo, which is acceptable for early uploads and bounded by the
  10 MB file cap.
- Re-encoding runs inside the Next.js process (ADR 0008). The file caps in
  `system/security.md` bound memory per request.
- Swapping any of them is an adapter change behind the two ports.
