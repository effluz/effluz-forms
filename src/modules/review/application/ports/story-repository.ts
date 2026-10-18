import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { IsoDate } from "../../domain/days";

/**
 * Review state of one submission: its planned and published days, the chosen
 * photos and the readiness ticks. No "ready" flag: readiness is worked out when
 * read (ADR 0028). Arrays hold media ids, sorted by the caller.
 */
export interface StoryRow {
  submissionId: string;
  formId: string;
  plannedOn: IsoDate | null;
  publishedOn: IsoDate | null;
  chosen: string[];
  photosEditedFor: string[] | null;
  photosEditedBy: string | null;
  photosEditedAt: Date | null;
  textCheckedBy: string | null;
  textCheckedAt: Date | null;
}

/** The state of a submission no one has planned, chosen photos for or ticked. */
export const emptyStory = (submissionId: string, formId: string): StoryRow => ({
  submissionId,
  formId,
  plannedOn: null,
  publishedOn: null,
  chosen: [],
  photosEditedFor: null,
  photosEditedBy: null,
  photosEditedAt: null,
  textCheckedBy: null,
  textCheckedAt: null,
});

/**
 * Where story rows live. Lock order: the submission row, then the story row,
 * then day locks in ascending date order (specs/system/database.md, "The `UnitOfWork` port").
 */
export interface StoryRepository {
  /** Null for an unknown id and for a non-UUID id. */
  find(submissionId: string): Promise<StoryRow | null>;
  /** Inserts the empty row when missing, then locks it until the unit of work ends. */
  lockOrCreate(uow: UnitOfWork, submissionId: string, formId: string): Promise<StoryRow>;
  /** Takes the day's advisory lock, then returns the unpublished story holding the day, locked, or null. */
  lockDay(uow: UnitOfWork, date: IsoDate): Promise<StoryRow | null>;
  /**
   * Writes the row, inserting it when missing; `at` becomes `updated_at`. A second
   * unpublished story on one day violates the unique index `story_plan_slot_key`.
   */
  save(uow: UnitOfWork, row: StoryRow, at: Date): Promise<void>;
}
