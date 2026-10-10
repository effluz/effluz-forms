import type { LocalizedText } from "@/shared/domain/localized-text";

/** FNV-1a 64-bit over the NFC text of both languages; stable across runs and platforms. */
export function consentTextVersion(text: LocalizedText): string {
  const input = `${(text.en ?? "").normalize("NFC")}\u0000${(text.es ?? "").normalize("NFC")}`;
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const ch of new TextEncoder().encode(input)) {
    hash ^= BigInt(ch);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}
