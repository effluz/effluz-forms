import type { AnyFieldType } from "../field-type";
import { createRegistry, type FieldTypeRegistry } from "../registry";
import { email } from "./email";
import { longText } from "./long-text";
import { phone } from "./phone";
import { shortText } from "./short-text";

export const defaultFieldTypes: readonly AnyFieldType[] = [shortText, longText, email, phone];

export function buildDefaultRegistry(): FieldTypeRegistry {
  return createRegistry(defaultFieldTypes);
}
