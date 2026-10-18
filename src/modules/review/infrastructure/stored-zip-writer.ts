import { crc32 } from "node:zlib";
import type { ZipEntry, ZipWriter } from "../application/ports/zip-writer";

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const LOCAL_SIZE = 30;
const CENTRAL_SIZE = 46;
const END_SIZE = 22;
/** ZIP 2.0: the version a reader needs for stored entries with UTF-8 names. */
const VERSION = 20;
/** General purpose flag bit 11: the name is UTF-8. */
const UTF8_FLAG = 0x0800;
const STORED = 0;
/** Without ZIP64, offsets and sizes are 32-bit and the entry count 16-bit. */
const MAX_32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

interface Written {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

/** MS-DOS time and date fields in UTC; years before 1980 become 1980-01-01. */
function dosDateTime(at: Date): { time: number; date: number } {
  if (at.getUTCFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 };
  const time = (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1);
  const date =
    ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate();
  return { time, date };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function localHeader(entry: Written): Uint8Array {
  const out = new Uint8Array(LOCAL_SIZE + entry.name.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, LOCAL_SIGNATURE, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, STORED, true);
  view.setUint16(10, entry.time, true);
  view.setUint16(12, entry.date, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.size, true);
  view.setUint32(22, entry.size, true);
  view.setUint16(26, entry.name.length, true);
  view.setUint16(28, 0, true);
  out.set(entry.name, LOCAL_SIZE);
  return out;
}

function centralDirectory(entries: readonly Written[], offset: number): Uint8Array {
  const size = entries.reduce((sum, e) => sum + CENTRAL_SIZE + e.name.length, 0);
  if (offset > MAX_32 || offset + size > MAX_32) throw new Error("zip is too large without ZIP64");
  const out = new Uint8Array(size + END_SIZE);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const entry of entries) {
    view.setUint32(at, CENTRAL_SIGNATURE, true);
    view.setUint16(at + 4, VERSION, true);
    view.setUint16(at + 6, VERSION, true);
    view.setUint16(at + 8, UTF8_FLAG, true);
    view.setUint16(at + 10, STORED, true);
    view.setUint16(at + 12, entry.time, true);
    view.setUint16(at + 14, entry.date, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.size, true);
    view.setUint32(at + 24, entry.size, true);
    view.setUint16(at + 28, entry.name.length, true);
    // Extra field, comment, disk number, internal and external attributes: all zero.
    view.setUint32(at + 42, entry.offset, true);
    out.set(entry.name, at + CENTRAL_SIZE);
    at += CENTRAL_SIZE + entry.name.length;
  }
  view.setUint32(at, END_SIGNATURE, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, size, true);
  view.setUint32(at + 16, offset, true);
  return out;
}

/**
 * Streams a ZIP of stored (uncompressed) entries, one file at a time: photos are
 * compressed already (specs/system/media-storage.md, "Downloads"). Each file is
 * read whole before its local header is written (files are at most 10 MB), so the
 * header carries the real CRC and sizes and no data descriptor is needed. Names
 * are UTF-8 (flag bit 11), times are the entry's `modifiedAt` in UTC, and there is
 * no ZIP64: a story stays far below 4 GB and 65,535 files.
 */
export class StoredZipWriter implements ZipWriter {
  write(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
    const iterator = entries[Symbol.asyncIterator]();
    const encoder = new TextEncoder();
    const written: Written[] = [];
    let offset = 0;
    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          for (;;) {
            const next = await iterator.next();
            if (next.done === true) {
              controller.enqueue(centralDirectory(written, offset));
              controller.close();
              return;
            }
            const stream = await next.value.open();
            if (stream === null) continue;
            const data = await readAll(stream);
            if (written.length >= MAX_ENTRIES) throw new Error("zip has too many entries");
            const entry: Written = {
              name: encoder.encode(next.value.name),
              crc: crc32(data) >>> 0,
              size: data.length,
              offset,
              ...dosDateTime(next.value.modifiedAt),
            };
            const header = localHeader(entry);
            offset += header.length + data.length;
            if (offset > MAX_32) throw new Error("zip is too large without ZIP64");
            written.push(entry);
            controller.enqueue(header);
            controller.enqueue(data);
            return;
          }
        },
        async cancel() {
          await iterator.return?.();
        },
      },
      { highWaterMark: 0 },
    );
  }
}
