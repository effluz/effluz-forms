# 0021. QR codes come from the `qrcode` library

Status: accepted
Date: 2026-10-10

## Context

The manager's Share tab (specs/ui-ux/manager.md) offers a QR code of a form's
public URL, downloadable as PNG (1024 px and 2048 px) and SVG. Staff print
it on posters and flyers, so it must scan reliably. Options were: write an
encoder in-house; call a hosted QR service; or add a maintained library.

## Decision

Add `qrcode` (with `@types/qrcode`) and render in the `definitions`
infrastructure layer, behind two small functions in `qr.ts`: a PNG at a
fixed size and an SVG. Both use a four-module quiet zone and error
correction level M.

- The code encodes the plain public URL only: `{PUBLIC_BASE_URL}/f/{slug}`.
  No tracking parameters, no campaign tags, no form content.
- Rendering is local. No URL ever leaves the server, and no third party sees
  which forms exist or when staff open them.
- The print-ready PDF with title and URL under the code is deferred. It
  needs a PDF dependency and a layout decision; the SVG and the 2048 px PNG
  cover printing until then.

## Consequences

- An in-house encoder would be an error-prone surface (Reed-Solomon, mask
  selection) for no gain. A hosted service would leak
  form URLs and add an availability dependency.
- One runtime dependency with no native code. Its output is a pure function
  of the URL, so the code never changes when staff publish a new version.
- If the PDF is built later, it supersedes the "deferred" part of this ADR;
  the encoder choice stands.
