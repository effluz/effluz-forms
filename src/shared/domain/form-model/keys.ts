import { z } from "zod";

export const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{3,31}$/, "key must be lowercase, start with a letter, 4 to 32 chars")
  .brand<"Key">();
export type Key = z.infer<typeof keySchema>;

export function asKey(value: string): Key {
  return keySchema.parse(value);
}

/** The prefix of a generated key: page, field or option. */
export type KeyPrefix = "p" | "f" | "o";

const KEY_HEX_LENGTH = 8;

/**
 * A page, field or option key: the prefix plus 8 hex characters of a fresh uuid.
 * The space is 32 bits; a collision surfaces as a parse error of the document.
 */
export function newKey(ids: { newId(): string }, prefix: KeyPrefix): Key {
  const hex = ids.newId().replaceAll("-", "").toLowerCase().slice(0, KEY_HEX_LENGTH);
  return asKey(`${prefix}_${hex}`);
}
