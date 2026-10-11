import type { Key } from "@/shared/domain/form-model";

export interface SubmissionSummary {
  total: number;
  lastReceivedAt: Date | null;
}

/**
 * Read-only submission figures the definitions module needs. The submissions
 * module supplies the real adapter; until then a null adapter answers zero.
 */
export interface SubmissionStats {
  summary(formIds: readonly string[]): Promise<Map<string, SubmissionSummary>>;
  countReceivedAfter(formId: string, after: Date): Promise<number>;
  countOlderThan(formId: string, months: number, now: Date): Promise<number>;
  answerCounts(formId: string, keys: readonly Key[]): Promise<Map<Key, number>>;
  hasAny(formId: string): Promise<boolean>;
}
