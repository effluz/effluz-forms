const MIN_DIGITS = 4;

/**
 * A submission's short reference, `<prefix>-<sequence>`.
 * See specs/form-definition.md, "Submissions".
 */
export function formatReference(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(MIN_DIGITS, "0")}`;
}
