import { z } from "zod";

export const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{3,31}$/, "key must be lowercase, start with a letter, 4 to 32 chars")
  .brand<"Key">();
export type Key = z.infer<typeof keySchema>;

export function asKey(value: string): Key {
  return keySchema.parse(value);
}
