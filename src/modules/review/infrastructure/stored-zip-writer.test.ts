import { describe, expect, it } from "vitest";
import { readStoredZip } from "../../../../tests/fakes/zip";
import type { ZipEntry } from "../application/ports/zip-writer";
import { StoredZipWriter } from "./stored-zip-writer";

const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      // Two chunks, so the writer has to join them.
      controller.enqueue(bytes.slice(0, Math.ceil(bytes.length / 2)));
      controller.enqueue(bytes.slice(Math.ceil(bytes.length / 2)));
      controller.close();
    },
  });

async function* entriesOf(list: ZipEntry[]): AsyncIterable<ZipEntry> {
  for (const entry of list) yield await Promise.resolve(entry);
}

describe("StoredZipWriter", () => {
  it("writes a stored ZIP that a reader accepts", async () => {
    const image = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = new TextEncoder().encode("hola");
    const at = new Date("2026-10-16T14:00:00Z");
    const body = new StoredZipWriter().write(
      entriesOf([
        { name: "a/1.jpg", modifiedAt: at, open: () => Promise.resolve(streamOf(image)) },
        { name: "a/gone.jpg", modifiedAt: at, open: () => Promise.resolve(null) },
        { name: "a/ñ.txt", modifiedAt: at, open: () => Promise.resolve(streamOf(text)) },
      ]),
    );
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());

    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const end = bytes.length - 22;
    expect([...bytes.subarray(end, end + 4)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(readStoredZip(bytes)).toEqual([
      { name: "a/1.jpg", data: image },
      { name: "a/ñ.txt", data: text },
    ]);
  });
});
