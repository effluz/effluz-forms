const HEADER = 8;
const LARGE_HEADER = 16;

function isPrintableAscii(bytes: Uint8Array, start: number): boolean {
  for (let i = start; i < start + 4; i++) {
    const byte = bytes[i];
    if (byte === undefined || byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

/**
 * Whether the bytes are a structurally sound ISO base media file: `ftyp`
 * first, every box size consistent with the data, and a `moov` box present.
 * A container check only; it does not decode media. See
 * specs/system/media-storage.md, "File handling rules".
 */
export function isWellFormedIsoBmff(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let boxes = 0;
  let sawMoov = false;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    if (remaining < HEADER) return false;
    if (!isPrintableAscii(bytes, offset + 4)) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (boxes === 0 && type !== "ftyp") return false;
    let size = view.getUint32(offset);
    let header = HEADER;
    if (size === 1) {
      if (remaining < LARGE_HEADER) return false;
      const large = view.getBigUint64(offset + HEADER);
      if (large > BigInt(remaining)) return false;
      size = Number(large);
      header = LARGE_HEADER;
    } else if (size === 0) {
      size = remaining;
    }
    if (size < header || size > remaining) return false;
    if (type === "moov") sawMoov = true;
    boxes++;
    offset += size;
  }
  return boxes > 0 && sawMoov;
}
