/**
 * A strict reader of stored (uncompressed) ZIP archives, for tests only. It
 * finds the end-of-central-directory record, walks the central directory,
 * and for each entry reads the local header, checks the method is 0, the
 * sizes agree and the CRC matches `zlib.crc32` of the bytes. Any mismatch
 * throws. Test-only: never imported by production code.
 */
import { crc32 } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;

function findEndRecord(view: DataView): number {
  for (let at = view.byteLength - EOCD_SIZE; at >= 0; at -= 1)
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  throw new Error("zip: no end-of-central-directory record");
}

export function readStoredZip(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndRecord(view);
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (centralOffset + centralSize !== end) throw new Error("zip: central directory size is wrong");
  const decoder = new TextDecoder("utf-8", { fatal: true });

  const entries: { name: string; data: Uint8Array }[] = [];
  let at = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new Error("zip: bad central header");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength));
    if (method !== 0 || compressed !== size) throw new Error(`zip: ${name} is not stored`);
    if ((flags & 0x0800) === 0) throw new Error(`zip: ${name} lacks the UTF-8 flag`);

    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE)
      throw new Error(`zip: bad local header for ${name}`);
    if (
      view.getUint32(localOffset + 14, true) !== crc ||
      view.getUint32(localOffset + 18, true) !== compressed ||
      view.getUint32(localOffset + 22, true) !== size
    )
      throw new Error(`zip: local header of ${name} disagrees with the central directory`);
    const localName = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const start = localOffset + LOCAL_SIZE + localName + localExtra;
    const data = bytes.slice(start, start + size);
    if (data.length !== size) throw new Error(`zip: ${name} is truncated`);
    if (crc32(data) >>> 0 !== crc) throw new Error(`zip: CRC of ${name} does not match`);
    entries.push({ name, data });
    at += CENTRAL_SIZE + nameLength + extraLength + commentLength;
  }
  return entries;
}
