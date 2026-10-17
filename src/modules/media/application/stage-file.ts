import { stagingKey } from "../domain/keys";
import { ACCEPTED_TYPES, acceptedType, extensionFor } from "../domain/media";
import type { MediaKind, StagedFile } from "../domain/media";
import { isWellFormedIsoBmff } from "../domain/iso-bmff";
import type { MediaDeps } from "./deps";

export type StageRefusal = "file_too_large" | "file_wrong_type" | "file_unreadable";

export interface StageFileInput {
  recordId: string;
  bytes: Uint8Array;
  accept: readonly MediaKind[];
  maxBytes: number;
}

export type StageFileResult = { ok: true; file: StagedFile } | { ok: false; code: StageRefusal };

/**
 * Checks, re-encodes and stages one uploaded file. Refusals are validation
 * errors shown to the submitter, never job failures; nothing is written
 * before every check passes. See specs/system/media-storage.md, "File
 * handling rules".
 */
export async function stageFile(deps: MediaDeps, input: StageFileInput): Promise<StageFileResult> {
  if (input.bytes.length > input.maxBytes) return { ok: false, code: "file_too_large" };

  const type = acceptedType(await deps.sniffer.sniff(input.bytes));
  if (type === null) return { ok: false, code: "file_wrong_type" };
  const kind = ACCEPTED_TYPES[type].kind;
  if (!input.accept.includes(kind)) return { ok: false, code: "file_wrong_type" };

  let bytes = input.bytes;
  let contentType: string = type;
  if (kind === "image") {
    const encoded = await deps.encoder.reencode(input.bytes, type);
    if (encoded === null) return { ok: false, code: "file_unreadable" };
    // Re-encoding can grow a file (a palette PNG, say), so the limit applies again.
    if (encoded.bytes.length > input.maxBytes) return { ok: false, code: "file_too_large" };
    bytes = encoded.bytes;
    contentType = encoded.contentType;
  } else if (!isWellFormedIsoBmff(input.bytes)) {
    return { ok: false, code: "file_unreadable" };
  }

  const id = deps.ids.newId();
  const stagingRef = stagingKey(input.recordId, id, extensionFor(contentType));
  await deps.staging.put(bytes, stagingRef, contentType);
  return { ok: true, file: { id, stagingRef, kind, contentType, size: bytes.length } };
}
