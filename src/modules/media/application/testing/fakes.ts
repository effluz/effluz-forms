/**
 * In-memory fakes for media use-case tests.
 *
 * - `fakeImage(type, size)`: `mime:<type>;` zero-padded to `size`; the
 *   fake sniffer reads the type back from that prefix.
 * - `InMemoryStorage`: staging and durable storage in one class. `files` holds
 *   the stored bytes by key; `failPut` makes `put` reject.
 * - `FakeSniffer`: `ftyp` at byte 4 is `video/mp4`, a `mime:<type>;` prefix is
 *   that type, anything else is unrecognised.
 * - `FakeEncoder`: the word `broken` in the bytes does not decode; otherwise
 *   the output is `reencoded:` plus the input, PNG and WebP kept, all else JPEG.
 * - `InMemoryMediaRepository`: `rows` by id, copies in and out; `markStored`
 *   answers false for a missing row, as the real adapter does.
 * - `makeMediaDeps(overrides?)`: every port filled with these fakes and the
 *   shared ones.
 *
 * Synthetic bytes only. Not for production code.
 */
import {
  FakeUnitOfWorkFactory,
  FixedClock,
  InMemoryJobQueue,
  SequentialIdGenerator,
} from "@/shared/application/testing/fakes";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { MediaRecord } from "../../domain/media";
import type { MediaDeps } from "../deps";
import type { ContentSniffer } from "../ports/content-sniffer";
import type { EncodedImage, ImageEncoder } from "../ports/image-encoder";
import type { MediaRepository } from "../ports/media-repository";
import type { StagingStorage } from "../ports/media-storage";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** `mime:<type>;` padded with zeros to `size` bytes (at least the prefix). */
export function fakeImage(type = "image/jpeg", size = 64): Uint8Array {
  const prefix = encode(`mime:${type};`);
  const out = new Uint8Array(Math.max(size, prefix.length));
  out.set(prefix);
  return out;
}

export class InMemoryStorage implements StagingStorage {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  failPut = false;

  put(bytes: Uint8Array, key: string, contentType: string): Promise<string> {
    if (this.failPut) return Promise.reject(new Error("storage unavailable"));
    this.files.set(key, { bytes: bytes.slice(), contentType });
    return Promise.resolve(key);
  }

  refForKey(key: string): string {
    return key;
  }

  viewUrl(ref: string): Promise<string> {
    return Promise.resolve(`memory://${ref}`);
  }

  delete(ref: string): Promise<void> {
    this.files.delete(ref);
    return Promise.resolve();
  }

  exists(ref: string): Promise<boolean> {
    return Promise.resolve(this.files.has(ref));
  }

  read(ref: string): Promise<Uint8Array> {
    const file = this.files.get(ref);
    if (file === undefined) return Promise.reject(new Error("file not found"));
    return Promise.resolve(file.bytes.slice());
  }

  deletePrefix(prefix: string): Promise<void> {
    for (const key of [...this.files.keys()]) if (key.startsWith(prefix)) this.files.delete(key);
    return Promise.resolve();
  }
}

export class FakeSniffer implements ContentSniffer {
  sniff(bytes: Uint8Array): Promise<string | null> {
    if (decode(bytes.subarray(4, 8)) === "ftyp") return Promise.resolve("video/mp4");
    const match = /^mime:([^;]+);/.exec(decode(bytes.subarray(0, 64)));
    return Promise.resolve(match?.[1] ?? null);
  }
}

export class FakeEncoder implements ImageEncoder {
  reencode(bytes: Uint8Array, contentType: string): Promise<EncodedImage | null> {
    if (decode(bytes).includes("broken")) return Promise.resolve(null);
    const keep = contentType === "image/png" || contentType === "image/webp";
    const prefix = encode("reencoded:");
    const out = new Uint8Array(prefix.length + bytes.length);
    out.set(prefix);
    out.set(bytes, prefix.length);
    return Promise.resolve({ bytes: out, contentType: keep ? contentType : "image/jpeg" });
  }
}

export class InMemoryMediaRepository implements MediaRepository {
  readonly rows = new Map<string, MediaRecord>();

  insert(_uow: UnitOfWork, record: MediaRecord): Promise<void> {
    if (this.rows.has(record.id)) return Promise.reject(new Error("duplicate media id"));
    this.rows.set(record.id, { ...record });
    return Promise.resolve();
  }

  findById(id: string): Promise<MediaRecord | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row === undefined ? null : { ...row });
  }

  listBySubmission(submissionId: string): Promise<MediaRecord[]> {
    const found = [...this.rows.values()]
      .filter((r) => r.submissionId === submissionId)
      .sort((a, b) => a.fieldKey.localeCompare(b.fieldKey) || a.position - b.position);
    return Promise.resolve(found.map((r) => ({ ...r })));
  }

  markStored(_uow: UnitOfWork, id: string, providerRef: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(false);
    this.rows.set(id, { ...row, status: "stored", providerRef, updatedAt: at });
    return Promise.resolve(true);
  }

  clearStaging(_uow: UnitOfWork, id: string, at: Date): Promise<void> {
    return this.patch(id, { stagingRef: null, updatedAt: at });
  }

  markFailed(_uow: UnitOfWork, id: string, at: Date): Promise<void> {
    return this.patch(id, { status: "failed", updatedAt: at });
  }

  delete(_uow: UnitOfWork, id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }

  private patch(id: string, changes: Partial<MediaRecord>): Promise<void> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.reject(new Error("media row not found"));
    this.rows.set(id, { ...row, ...changes });
    return Promise.resolve();
  }
}

export interface FakeMediaDeps extends MediaDeps {
  staging: InMemoryStorage;
  durable: InMemoryStorage;
  media: InMemoryMediaRepository;
  queue: InMemoryJobQueue;
  ids: SequentialIdGenerator;
  clock: FixedClock;
}

export function makeMediaDeps(overrides: Partial<FakeMediaDeps> = {}): FakeMediaDeps {
  return {
    staging: new InMemoryStorage(),
    durable: new InMemoryStorage(),
    sniffer: new FakeSniffer(),
    encoder: new FakeEncoder(),
    media: new InMemoryMediaRepository(),
    queue: new InMemoryJobQueue(),
    uow: new FakeUnitOfWorkFactory(),
    ids: new SequentialIdGenerator(),
    clock: new FixedClock(),
    ...overrides,
  };
}
