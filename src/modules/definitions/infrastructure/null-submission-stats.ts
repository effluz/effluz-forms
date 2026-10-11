import type { Key } from "@/shared/domain/form-model";
import type { SubmissionStats, SubmissionSummary } from "../application/ports/submission-stats";

/** Stands in until the submissions module exists: no form has any submission. */
export class NullSubmissionStats implements SubmissionStats {
  summary(formIds: readonly string[]): Promise<Map<string, SubmissionSummary>> {
    return Promise.resolve(
      new Map(formIds.map((id) => [id, { total: 0, lastReceivedAt: null }] as const)),
    );
  }

  countReceivedAfter(): Promise<number> {
    return Promise.resolve(0);
  }

  countOlderThan(): Promise<number> {
    return Promise.resolve(0);
  }

  answerCounts(_formId: string, keys: readonly Key[]): Promise<Map<Key, number>> {
    return Promise.resolve(new Map(keys.map((key) => [key, 0] as const)));
  }

  hasAny(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
