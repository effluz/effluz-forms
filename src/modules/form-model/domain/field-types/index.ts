import type { AnyFieldType } from "../field-type";
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

export const defaultFieldTypes: readonly AnyFieldType[] = [
  shortText,
  longText,
  email,
  phone,
  numberType,
  date,
  singleChoice,
  multipleChoice,
  checkbox,
  consent,
  fileUpload,
  section,
];

export function buildDefaultRegistry(): FieldTypeRegistry {
  return createRegistry(defaultFieldTypes);
}
