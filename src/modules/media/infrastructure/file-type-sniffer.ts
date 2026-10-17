import { fileTypeFromBuffer } from "file-type";
import type { ContentSniffer } from "../application/ports/content-sniffer";

/**
 * Names a file by its magic numbers alone; a declared type or extension never
 * decides. See specs/system/media-storage.md, "File handling rules", and ADR 0023.
 */
export class FileTypeSniffer implements ContentSniffer {
  async sniff(bytes: Uint8Array): Promise<string | null> {
    if (bytes.length === 0) return null;
    return (await fileTypeFromBuffer(bytes))?.mime ?? null;
  }
}
