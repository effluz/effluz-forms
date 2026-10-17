import type { FieldTypeId } from "@/shared/domain/form-model";
import { checkbox } from "./checkbox";
import { multipleChoice, singleChoice } from "./choice";
import { consent } from "./consent";
import { date } from "./date";
import { fileUpload } from "./file-upload";
import { number } from "./number";
import { section } from "./section";
import { email, longText, phone, shortText } from "./text";
import type { FieldRenderer } from "./types";

export type {
  Decoded,
  FieldInput,
  FieldProps,
  FieldRenderer,
  FileRowView,
  FormValues,
} from "./types";
export { ids, many, one } from "./types";

/**
 * The renderer of every field type, by id. A type without one fails the type check here and
 * the renderer conformance test (CLAUDE.md, "The form model is the contract").
 */
export const fieldRenderers = {
  short_text: shortText,
  long_text: longText,
  email,
  phone,
  number,
  date,
  single_choice: singleChoice,
  multiple_choice: multipleChoice,
  checkbox,
  consent,
  file_upload: fileUpload,
  section,
} as const satisfies Record<FieldTypeId, FieldRenderer>;
