import type { FieldTypeId } from "@/shared/domain/form-model";
import { multiple_choice, single_choice } from "./choice";
import { consent } from "./consent";
import { file_upload } from "./file-upload";
import { section } from "./section";
import { checkbox, date, number } from "./simple";
import { email, long_text, phone, short_text } from "./text";
import type { ReviewDisplay } from "./types";

export type { ReviewDisplay } from "./types";

/**
 * The review display of every field type, by id. A field type without one fails typecheck
 * here and the conformance test.
 */
export const reviewDisplays = {
  short_text,
  long_text,
  email,
  phone,
  number,
  date,
  single_choice,
  multiple_choice,
  checkbox,
  consent,
  file_upload,
  section,
} as const satisfies Record<FieldTypeId, ReviewDisplay>;
