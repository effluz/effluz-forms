import { graphemeLength } from "@/shared/domain/form-model";

export type CorrectionCheck =
  | { ok: true; text: string }
  | { ok: false; code: "correction_blank" | "correction_too_long"; max: number };

/** CRLF and CR become LF; blank after trimming is refused; the limit counts graphemes. */
export function checkCorrection(text: string, maxLength: number): CorrectionCheck {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized.trim() === "") return { ok: false, code: "correction_blank", max: maxLength };
  if (graphemeLength(normalized) > maxLength) {
    return { ok: false, code: "correction_too_long", max: maxLength };
  }
  return { ok: true, text: normalized };
}
