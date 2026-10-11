import type { AnyFieldType, FieldTypeId } from "../field-type";
import { OPERATORS, type OperatorDefinition } from "../operators";
import { createRegistry, type FieldTypeRegistry } from "../registry";
import { checkbox } from "./checkbox";
import { consent } from "./consent";
import { date } from "./date";
import { email } from "./email";
import { fileUpload } from "./file-upload";
import { longText } from "./long-text";
import { multipleChoice } from "./multiple-choice";
import { numberType } from "./number";
import { phone } from "./phone";
import { section } from "./section";
import { shortText } from "./short-text";
import { singleChoice } from "./single-choice";

/** Every field type definition of the first release, by id. */
export const fieldTypes = {
  short_text: shortText,
  long_text: longText,
  email,
  phone,
  number: numberType,
  date,
  single_choice: singleChoice,
  multiple_choice: multipleChoice,
  checkbox,
  consent,
  file_upload: fileUpload,
  section,
} as const satisfies Record<FieldTypeId, AnyFieldType>;

export const defaultFieldTypes: readonly AnyFieldType[] = [
  shortText,
  longText,
  email,
  phone,
  singleChoice,
  multipleChoice,
  checkbox,
  numberType,
  date,
  fileUpload,
  consent,
  section,
];

export function buildDefaultRegistry(): FieldTypeRegistry {
  return createRegistry(defaultFieldTypes);
}

export function operatorsFor(
  registry: FieldTypeRegistry,
  typeId: FieldTypeId,
): OperatorDefinition[] {
  return registry.get(typeId).allowedOperators.map((id) => OPERATORS[id]);
}
